"use client";

import { useEffect, useRef, useState } from "react";

type ExpandedImage = {
  src: string;
  alt: string;
};

// The application renders pictures on many separate pages. Event delegation lets
// existing and future <img> previews use one viewer without changing upload flows.
function findImage(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-fullscreen-image-viewer], [data-no-fullscreen-preview]")) {
    return null;
  }

  if (target instanceof HTMLImageElement) return target;

  // A number of existing previews are wrapped in links to the original file.
  const link = target.closest("a");
  return link?.querySelector("img") ?? null;
}

function getPreview(image: HTMLImageElement): ExpandedImage | null {
  const src = image.currentSrc || image.src;
  if (!src || (image.complete && image.naturalWidth === 0)) return null;
  return { src, alt: image.alt || "รูปภาพ" };
}

export default function FullscreenImageViewer() {
  const [expanded, setExpanded] = useState<ExpandedImage | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function prepareImage(image: HTMLImageElement) {
      if (image.closest("[data-fullscreen-image-viewer], [data-no-fullscreen-preview]")) {
        return;
      }

      image.style.cursor = "zoom-in";
      if (!image.closest("a, button, [role='button']")) {
        // Standalone images should be expandable without needing a mouse/touch.
        if (!image.hasAttribute("tabindex")) image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.setAttribute("aria-label", "ดูภาพเต็มจอ: " + (image.alt || "รูปภาพ"));
      }
    }

    function prepareNode(node: Node) {
      if (node instanceof HTMLImageElement) {
        prepareImage(node);
      } else if (node instanceof Element) {
        node.querySelectorAll("img").forEach(prepareImage);
      }
    }

    prepareNode(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach(prepareNode);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function open(image: HTMLImageElement) {
      const preview = getPreview(image);
      if (!preview) return false;
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setExpanded(preview);
      return true;
    }

    function handleClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const image = findImage(event.target);
      if (image && open(image)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" && event.key !== " ") return;
      const image = findImage(event.target);
      if (image && open(image)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!expanded) return;

    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleViewerKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setExpanded(null);
      } else if (event.key === "Tab") {
        // The close button is the only control in this modal.
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleViewerKeys);
    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", handleViewerKeys);
      previousFocusRef.current?.focus();
    };
  }, [expanded]);

  if (!expanded) return null;

  return (
    <div
      data-fullscreen-image-viewer
      role="dialog"
      aria-modal="true"
      aria-label={"ดูภาพเต็มจอ: " + expanded.alt}
      className="fixed inset-0 z-[9999] flex h-[100dvh] flex-col bg-[#061815]/95 px-3 text-white"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 68px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
      }}
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={() => setExpanded(null)}
        aria-label="ปิดภาพเต็มจอ"
        className="absolute right-4 flex min-h-11 items-center gap-2 rounded-full border border-white/30 bg-white/15 px-4 py-2 text-sm font-bold text-white backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FFE500]"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <span aria-hidden="true" className="text-2xl leading-none">×</span>
        ปิด
      </button>
      <div
        className="flex min-h-0 w-full flex-1 items-center justify-center overflow-auto"
        onClick={() => setExpanded(null)}
      >
        {/* This must support signed storage URLs and local blob: upload previews. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={expanded.src}
          alt={expanded.alt}
          className="max-h-full max-w-full select-none object-contain"
          style={{ touchAction: "pan-x pan-y pinch-zoom" }}
          onClick={(event) => event.stopPropagation()}
        />
      </div>
      <p className="mx-auto mt-3 max-w-3xl shrink-0 text-center text-xs text-white/80 sm:text-sm">
        {expanded.alt}
      </p>
    </div>
  );
}
