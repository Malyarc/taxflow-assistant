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
 * For PDFs we render the first page to a canvas using pdfjs-dist. Multi-page
 * documents only show page 1 for now — fine for W-2 / 1099 forms which are
 * single-page.
 */
import * as React from "react";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import { cn } from "@/lib/utils";

GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
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
    return (
      <ImageViewer src={src} boxes={boxes} highlightField={highlightField} onBoxClick={onBoxClick} className={className} />
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

  // Re-measure on window resize so boxes stay aligned when the modal width changes.
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

// ─── PDF rendering ───────────────────────────────────────────────────────────

function PdfViewer({ src, boxes, highlightField, onBoxClick, className }: Omit<Props, "fileName">) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function render() {
      try {
        const loadingTask = getDocument({ url: src });
        const pdf = await loadingTask.promise;
        if (cancelled) return;
        const page = await pdf.getPage(1);
        const canvas = canvasRef.current;
        const wrapper = wrapperRef.current;
        if (!canvas || !wrapper) return;
        const wrapperWidth = wrapper.clientWidth || 600;
        const baseViewport = page.getViewport({ scale: 1 });
        // Fit to wrapper width, then upscale for HiDPI so the canvas looks sharp.
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
    render();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) {
    return (
      <div className="border rounded p-4 text-sm text-destructive">
        Could not render PDF preview: {error}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={cn("relative inline-block w-full", className)}>
      <canvas ref={canvasRef} className="select-none" />
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
        // Boxes are 0–1000 normalized; map to container pixels.
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
                : "border-blue-500/50 bg-blue-100/15 hover:bg-blue-200/30",
            )}
            style={{ left, top, width, height }}
            title={field}
          />
        );
      })}
    </div>
  );
}
