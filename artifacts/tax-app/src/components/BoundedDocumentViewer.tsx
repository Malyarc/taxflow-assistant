/**
 * BoundedDocumentViewer
 *
 * Renders a document (image or PDF) and overlays AI-extracted bounding boxes
 * on top. Boxes are normalized 0–1000 image coordinates (Gemini convention).
 *
 * Used by the AI-extraction review modal: the CPA focuses a form input on the
 * right, the corresponding box highlights on the left. Click a box on the left
 * to focus its input on the right via the `onBoxClick` callback.
 *
 * For PDFs we render one page at a time to a canvas using pdfjs-dist, with
 * prev/next page controls. Boxes carry an optional `page` field (1-indexed);
 * absent = page 1. Boxes are only drawn when on the currently-visible page.
 *
 * Images are always treated as single-page (page 1).
 */
import * as React from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  /** 1-indexed PDF page number. Defaults to 1 if absent. */
  page?: number;
}

export type FieldBoxes = Record<string, BoundingBox>;

interface Props {
  /** URL of the document (e.g. `/api/clients/123/documents/456/content`). */
  src: string;
  /** Original filename — used to determine PDF vs image rendering. */
  fileName: string;
  /** Per-field bounding boxes from extraction. Keys identify the field. */
  boxes: FieldBoxes;
  /** Field whose box should be drawn with an accent color. */
  highlightField: string | null;
  /** Optional click handler — fires with the field name when a box is clicked. */
  onBoxClick?: (field: string) => void;
  className?: string;
}

/** Boxes assumed to be on page 1 if no `page` field is set (single-page convention). */
function boxPage(b: BoundingBox): number {
  return typeof b.page === "number" && b.page > 0 ? Math.floor(b.page) : 1;
}

/** Filter the box record to those on a specific page. */
function boxesForPage(all: FieldBoxes, pageNum: number): FieldBoxes {
  const out: FieldBoxes = {};
  for (const [field, b] of Object.entries(all)) {
    if (boxPage(b) === pageNum) out[field] = b;
  }
  return out;
}

export function BoundedDocumentViewer({
  src,
  fileName,
  boxes,
  highlightField,
  onBoxClick,
  className,
}: Props) {
  const lower = fileName.toLowerCase();
  const isPdf = lower.endsWith(".pdf");
  const isImage = /\.(jpe?g|png|webp|gif)$/i.test(lower);

  if (isPdf) {
    return (
      <PdfViewer src={src} boxes={boxes} highlightField={highlightField} onBoxClick={onBoxClick} className={className} />
    );
  }
  if (isImage) {
    // Images are always page 1.
    return (
      <ImageViewer
        src={src}
        boxes={boxesForPage(boxes, 1)}
        highlightField={highlightField}
        onBoxClick={onBoxClick}
        className={className}
      />
    );
  }
  // Plain text / other — no overlay possible, just iframe the content.
  return <iframe src={src} className={cn("w-full h-[75vh] border rounded bg-muted", className)} title={fileName} />;
}

// ─── Image rendering ─────────────────────────────────────────────────────────

function ImageViewer({ src, boxes, highlightField, onBoxClick, className }: Omit<Props, "fileName">) {
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const imgRef = React.useRef<HTMLImageElement>(null);

  function onLoad() {
    const el = imgRef.current;
    if (!el) return;
    setSize({ w: el.clientWidth, h: el.clientHeight });
  }

  React.useEffect(() => {
    if (!imgRef.current) return;
    const obs = new ResizeObserver(() => {
      if (imgRef.current) setSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
    });
    obs.observe(imgRef.current);
    return () => obs.disconnect();
  }, []);

  return (
    <div className={cn("relative inline-block w-full", className)}>
      <img ref={imgRef} src={src} alt="" onLoad={onLoad} className="w-full h-auto select-none" />
      {size && (
        <BoxOverlay
          boxes={boxes}
          highlightField={highlightField}
          onBoxClick={onBoxClick}
          containerWidth={size.w}
          containerHeight={size.h}
        />
      )}
    </div>
  );
}

// ─── PDF rendering with pagination ───────────────────────────────────────────

function PdfViewer({ src, boxes, highlightField, onBoxClick, className }: Omit<Props, "fileName">) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [numPages, setNumPages] = React.useState<number>(0);
  const [pageNum, setPageNum] = React.useState<number>(1);
  const [error, setError] = React.useState<string | null>(null);
  const pdfRef = React.useRef<Awaited<ReturnType<typeof getDocument>["promise"]> | null>(null);

  // Pre-compute how many boxes live on each page so we can show indicators
  // in the page picker for pages with extracted fields.
  const boxCountByPage = React.useMemo(() => {
    const counts: Record<number, number> = {};
    for (const b of Object.values(boxes)) {
      const p = boxPage(b);
      counts[p] = (counts[p] ?? 0) + 1;
    }
    return counts;
  }, [boxes]);

  // Reset to page 1 whenever the document src changes.
  React.useEffect(() => {
    setPageNum(1);
    setNumPages(0);
    pdfRef.current = null;
  }, [src]);

  // Load the PDF once per src; then render whenever pageNum changes.
  React.useEffect(() => {
    let cancelled = false;
    async function loadAndRender() {
      try {
        // Load the PDF once per src.
        if (!pdfRef.current) {
          const loadingTask = getDocument({ url: src });
          pdfRef.current = await loadingTask.promise;
          if (cancelled) return;
          setNumPages(pdfRef.current.numPages);
        }
        const pdf = pdfRef.current;
        if (!pdf) return;
        // Clamp page number in case caller (or page boxes) pointed past the end.
        const effectivePage = Math.min(Math.max(1, pageNum), pdf.numPages);
        const page = await pdf.getPage(effectivePage);
        const canvas = canvasRef.current;
        const wrapper = wrapperRef.current;
        if (!canvas || !wrapper) return;
        const wrapperWidth = wrapper.clientWidth || 600;
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = wrapperWidth / baseViewport.width;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (cancelled) return;
        setSize({ w: viewport.width / dpr, h: viewport.height / dpr });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to render PDF");
      }
    }
    loadAndRender();
    return () => {
      cancelled = true;
    };
  }, [src, pageNum]);

  if (error) {
    return (
      <div className="border rounded p-4 text-sm text-destructive">
        Could not render PDF preview: {error}
      </div>
    );
  }

  const visibleBoxes = boxesForPage(boxes, pageNum);
  const isMultiPage = numPages > 1;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Page navigation — only shown for multi-page PDFs */}
      {isMultiPage && (
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPageNum((p) => Math.max(1, p - 1))}
              disabled={pageNum <= 1}
              className="inline-flex items-center justify-center size-7 rounded border border-input hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="px-2 py-1 tabular-nums">
              Page {pageNum} of {numPages}
            </span>
            <button
              type="button"
              onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
              disabled={pageNum >= numPages}
              className="inline-flex items-center justify-center size-7 rounded border border-input hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
          {/* Show which pages have AI-extracted fields */}
          {Object.keys(boxCountByPage).length > 0 && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <span>Extracted fields on:</span>
              {Object.entries(boxCountByPage)
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([p, count]) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPageNum(Number(p))}
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                      Number(p) === pageNum
                        ? "bg-amber-200 text-amber-900 font-semibold"
                        : "bg-amber-100 text-amber-800 hover:bg-amber-200",
                    )}
                  >
                    p{p}·{count}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      <div ref={wrapperRef} className="relative inline-block w-full">
        <canvas ref={canvasRef} className="select-none" />
        {size && (
          <BoxOverlay
            boxes={visibleBoxes}
            highlightField={highlightField}
            onBoxClick={onBoxClick}
            containerWidth={size.w}
            containerHeight={size.h}
          />
        )}
      </div>
    </div>
  );
}

// ─── Box overlay ─────────────────────────────────────────────────────────────

interface OverlayProps {
  boxes: FieldBoxes;
  highlightField: string | null;
  onBoxClick?: (field: string) => void;
  containerWidth: number;
  containerHeight: number;
}

function BoxOverlay({ boxes, highlightField, onBoxClick, containerWidth, containerHeight }: OverlayProps) {
  return (
    <div className="absolute inset-0 pointer-events-none">
      {Object.entries(boxes).map(([field, box]) => {
        const left = (box.xmin / 1000) * containerWidth;
        const top = (box.ymin / 1000) * containerHeight;
        const width = ((box.xmax - box.xmin) / 1000) * containerWidth;
        const height = ((box.ymax - box.ymin) / 1000) * containerHeight;
        const isActive = field === highlightField;
        return (
          <div
            key={field}
            onClick={() => onBoxClick?.(field)}
            className={cn(
              "absolute border-2 transition-colors",
              onBoxClick ? "pointer-events-auto cursor-pointer" : "",
              isActive
                ? "border-amber-500 bg-amber-200/30 ring-2 ring-amber-500/40"
                : "border-brand/50 bg-brand/10 hover:bg-brand/10",
            )}
            style={{ left, top, width, height }}
            title={field}
          />
        );
      })}
    </div>
  );
}
