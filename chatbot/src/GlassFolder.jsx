import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import HarnessIcon from "./HarnessIcon";
import { folderTexture, FOLDER_PALETTES } from "./glass-folder-engine.js";
import "./glass-folder.css";

// Internal geometry from the design spec: the back plate lives in a 340×272
// canvas, the sheet stack rises 54px above it, so the stage is 340×326 and the
// whole thing scales from its top-left corner as the slot narrows.
const STAGE_WIDTH = 340;
const STAGE_HEIGHT = 326;
const MAX_VISIBLE = 4;

const DEFAULT_FILES = [
  { id: "cover", name: "Cover — final", meta: "PNG · 4.8 MB", tone: "ember" },
  { id: "moodboard", name: "Moodboard", meta: "24 images", tone: "dusk" },
  { id: "brief", name: "Brief.pdf", meta: "PDF · 1.2 MB", tone: "paper" },
];

const FILE_ICON = {
  ember: "image",
  dusk: "image",
  paper: "doc",
};

let nextFileId = 0;

function addFileRow(files, index) {
  nextFileId += 1;
  const palette = ["ember", "dusk", "glacier", "aurora", "verdant"];
  const tone = palette[index % palette.length];
  return {
    id: `sheet-${nextFileId}`,
    name: `Untitled ${nextFileId + 1}`,
    meta: "新纸张",
    tone,
  };
}

/**
 * A glass folder card.
 *
 * The back plate is a canvas texture painted from the seeded noise engine; the
 * front plate is a frosted pane that actually blurs the sheets behind it via
 * backdrop-filter (never a screenshot swap). Motion follows the spec's three
 * states (idle / hover / open) and honours reduced-motion by keeping the state
 * change but dropping the travel.
 */
export default function GlassFolder({
  title = "My Files",
  caption = "",
  meta = "3 files",
  variant = "aurora",
  files: initialFiles = DEFAULT_FILES,
  height,
  reducedMotion,
  onSelect,
}) {
  const stage = useRef(null);
  const front = useRef(null);
  const menuTrigger = useRef(null);
  const menu = useRef(null);
  const canvasHost = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [files, setFiles] = useState(() => initialFiles.slice(0, MAX_VISIBLE));
  const [entering, setEntering] = useState("");
  const [announce, setAnnounce] = useState("");
  const timer = useRef(0);
  const labelId = useId();

  const reduce =
    reducedMotion ??
    (typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) ??
    false;

  // Scale the fixed 340×326 stage to whatever width the slot gives us.
  useEffect(() => {
    const node = stage.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width || STAGE_WIDTH;
      node.style.setProperty("--gf-scale", String(width / STAGE_WIDTH));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Paint the back plate once per variant. The texture is painted in strips
  // with a per-frame budget so a cold mount never blocks the first input.
  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return undefined;
    let cancelled = false;
    const paint = () => {
      if (cancelled) return;
      const canvas = folderTexture(variant, 340, 272);
      if (!canvas || !host) return;
      host.replaceChildren(canvas);
      canvas.className = "gf-texture-canvas";
    };
    // Reduced motion still needs the first frame; it just skips the stagger.
    const frame = requestAnimationFrame(paint);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [variant]);

  const closeMenu = useCallback((focus) => {
    setMenuOpen(false);
    if (focus) requestAnimationFrame(() => menuTrigger.current?.focus());
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDown = (event) => {
      if (
        menu.current?.contains(event.target) ||
        menuTrigger.current?.contains(event.target)
      )
        return;
      closeMenu(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const items = [
        ...(menu.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') ||
          []),
      ];
      if (!items.length) return;
      event.preventDefault();
      const at = items.indexOf(document.activeElement);
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : (at + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
      items[next].focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toggle = useCallback(() => {
    setOpen((value) => {
      const next = !value;
      setAnnounce(next ? `${title} 已展开` : `${title} 已关闭`);
      return next;
    });
  }, [title]);

  const addFile = useCallback(() => {
    setFiles((current) => {
      const row = addFileRow(current, current.length);
      setEntering(row.id);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setEntering(""), reduce ? 0 : 900);
      setAnnounce(`已添加 ${row.name}`);
      return [...current, row].slice(-MAX_VISIBLE);
    });
  }, [reduce]);

  const resetFiles = useCallback(() => {
    setFiles(initialFiles.slice(0, MAX_VISIBLE));
    setAnnounce(`${title} 已恢复默认纸张`);
  }, [initialFiles, title]);

  const pick = useCallback(
    (file) => {
      setAnnounce(`已选择 ${file.name}`);
      onSelect?.(file);
    },
    [onSelect],
  );

  // Pointer drives a light 3D tilt and a moving highlight on the glass.
  const onPointerMove = useCallback(
    (event) => {
      if (reduce) return;
      const node = front.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const dx = (event.clientX - rect.left) / rect.width - 0.5;
      const dy = (event.clientY - rect.top) / rect.height - 0.5;
      node.style.setProperty("--gf-tilt-x", `${(-dy * 6).toFixed(2)}deg`);
      node.style.setProperty("--gf-tilt-y", `${(dx * 8).toFixed(2)}deg`);
      node.style.setProperty("--gf-glare-x", `${(50 + dx * 60).toFixed(1)}%`);
      node.style.setProperty("--gf-glare-y", `${(50 + dy * 60).toFixed(1)}%`);
    },
    [reduce],
  );
  const onPointerLeave = useCallback(() => {
    const node = front.current;
    if (!node) return;
    node.style.removeProperty("--gf-tilt-x");
    node.style.removeProperty("--gf-tilt-y");
    node.style.removeProperty("--gf-glare-x");
    node.style.removeProperty("--gf-glare-y");
  }, []);

  const rendered = useMemo(
    () =>
      files.map((file, index) => ({
        ...file,
        index,
        depth: files.length - 1 - index,
      })),
    [files],
  );

  const menuPanel =
    menuOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menu}
            className="gf-menu"
            role="menu"
            aria-label={`${title} 操作`}
            style={menuPosition(menuTrigger.current)}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                toggle();
                closeMenu(true);
              }}
            >
              {open ? "Close folder" : "Open folder"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                addFile();
                closeMenu(true);
              }}
            >
              Add a file
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                resetFiles();
                closeMenu(true);
              }}
            >
              Reset contents
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={stage}
      className={`gf glass-folder${open ? " is-open" : ""}`}
      style={{ "--gf-scale": 1, ...(height ? { height } : null) }}
    >
      <div className="gf-scale">
        <div
          className={`gf-card${open ? " is-open" : ""}`}
          data-variant={variant}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onKeyDown={(event) => {
            if (event.target !== front.current) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggle();
            }
          }}
        >
          {/* Back plate: canvas texture clipped to the folder silhouette.
              It has to be an HTML element — SVG foreignObject is not clipped
              reliably across browsers, and backdrop-filter never applies to an
              SVG path. */}
          <div className="gf-back" aria-hidden="true">
            <div
              ref={canvasHost}
              className="gf-texture"
              style={{ width: 340, height: 272 }}
            />
          </div>

          {/* Sheet stack, back-to-front. Closed folders keep the list inert
              so the file buttons cannot be reached by keyboard. */}
          <div
            className="gf-sheets"
            inert={!open}
            aria-hidden={!open ? "true" : undefined}
          >
            {rendered.map((file) => {
              const lead = file.index === files.length - 1;
              const style = {
                "--depth": file.depth,
                "--fan": `${file.index * 0.9}deg`,
                zIndex: 5 + file.index,
              };
              return (
                <div
                  key={file.id}
                  className={`gf-sheet${entering === file.id ? " is-entering" : ""}${lead ? " is-lead" : ""}`}
                  style={style}
                >
                  <div className="gf-sheet-head">
                    <span>{file.name}</span>
                    <span>{file.meta}</span>
                  </div>
                  {lead ? (
                    // The sheet itself is decorative: content stays behind
                    // frosted glass at 22px blur. The real, readable list is
                    // the native-size panel below.
                    <ul className="gf-sheet-list" aria-hidden="true">
                      {files.map((row) => (
                        <li key={row.id} className="gf-file">
                          <HarnessIcon
                            name={FILE_ICON[row.tone] || "doc"}
                            size={13}
                            interactive={false}
                          />
                          <span>{row.name}</span>
                          <small>{row.meta}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="gf-sheet-ghost" aria-hidden="true">
                      {files.map((row) => (
                        <span key={row.id} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Front glass plate — a real element so backdrop-filter actually
              blurs the sheets behind it (an SVG path cannot). The outline is
              drawn by a separate SVG on top. */}
          <div className="gf-front-wrap">
            <div className="gf-front-glass">
              <span className="gf-glare" aria-hidden="true" />
            </div>
            <svg
              className="gf-front"
              viewBox="0 0 340 198"
              aria-hidden="true"
              focusable="false"
            >
              <path
                className="gf-front-edge"
                d="M0 22A22 22 0 0 1 22 0L118 0C144 0 146 32 172 32L318 32A22 22 0 0 1 340 54L340 176A22 22 0 0 1 318 198L22 198A22 22 0 0 1 0 176Z"
              />
            </svg>
          </div>

          {/* Invisible hit area over the glass. It lives inside the scaled
              stage so its geometry matches the pane, but the visible label
              and buttons below are kept at native size — scaling the whole
              card down to a 195px column would shrink 18px type to 10px. */}
          <button
            ref={front}
            type="button"
            className="gf-hit"
            aria-label={`${open ? "收起" : "展开"} ${title}`}
            aria-expanded={open}
            aria-controls={`${labelId}-ledger`}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle();
              }
            }}
          />
        </div>
      </div>

      {/* The readable file list. It opens as a native-size panel anchored over
          the folder, because the glass pane deliberately blurs the paper and
          scaling 12px rows down to a 195px column would make them unreadable. */}
      {open ? (
        <div
          className="gf-panel"
          role="group"
          aria-label={`${title} 的文件`}
        >
          <div className="gf-panel-head">
            <strong>{title}</strong>
            <button
              type="button"
              className="gf-panel-close"
              aria-label="收起文件列表"
              onClick={() => toggle()}
            >
              <HarnessIcon name="close" size={14} interactive={false} />
            </button>
          </div>
          <ul className="gf-panel-list">
            {files.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="gf-panel-file"
                  onClick={() => pick(row)}
                >
                  <HarnessIcon
                    name={FILE_ICON[row.tone] || "doc"}
                    size={14}
                    interactive={false}
                  />
                  <span>{row.name}</span>
                  <small>{row.meta}</small>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Label and actions sit on the glass but outside the scale transform. */}
      <div className="gf-overlay">
        <span className="gf-label">
          <span className="gf-label-title">{title}</span>
          <span className="gf-label-meta">
            {caption || `${files.length} files`}
          </span>
        </span>
        <span className="gf-count" aria-hidden="true">
          {files.length} 张
        </span>
        <button
          type="button"
          className="gf-add"
          title="添加纸张"
          aria-label="添加纸张"
          onClick={(event) => {
            event.stopPropagation();
            addFile();
          }}
        >
          <HarnessIcon name="plus" size={15} interactive={false} />
        </button>
        <button
          ref={menuTrigger}
          type="button"
          className="gf-more"
          title="更多操作"
          aria-label={`${title} 更多操作`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((value) => !value);
          }}
        >
          <HarnessIcon name="more" size={15} interactive={false} />
        </button>
      </div>

      <p id={`${labelId}-ledger`} className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      {menuPanel}
    </div>
  );
}

function menuPosition(trigger) {
  if (!trigger || typeof window === "undefined") return {};
  const rect = trigger.getBoundingClientRect();
  const width = 168;
  let left = rect.right - width;
  if (left < 8) left = 8;
  const below = window.innerHeight - rect.bottom;
  const up = below < 150 && rect.top > below;
  return {
    left: `${left}px`,
    width: `${width}px`,
    ...(up
      ? { top: "auto", bottom: `${window.innerHeight - rect.top + 6}px` }
      : { top: `${rect.bottom + 6}px`, bottom: "auto" }),
  };
}

export { GlassFolder, FOLDER_PALETTES };
