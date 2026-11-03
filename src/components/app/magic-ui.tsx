"use client";

import React, {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import styles from "./magic-ui.module.css";

/* =========================================================================
   1. MagicCard: Spotlight radial cursor tracking + hover lift
   ========================================================================= */
export interface MagicCardProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  interactive?: boolean;
  className?: string;
}

export function MagicCard({
  children,
  interactive = true,
  className = "",
  style,
  onPointerMove,
  ...rest
}: MagicCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (interactive && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      cardRef.current.style.setProperty("--spot-x", `${x}px`);
      cardRef.current.style.setProperty("--spot-y", `${y}px`);
    }
    if (onPointerMove) onPointerMove(e);
  };

  return (
    <div
      ref={cardRef}
      className={`${styles.magicCard} ${className}`}
      data-interactive={interactive}
      style={style}
      onPointerMove={handlePointerMove}
      {...rest}
    >
      {children}
    </div>
  );
}

/* =========================================================================
   2. BorderBeam: Animated perimeter light beam for featured cards
   ========================================================================= */
export interface BorderBeamProps {
  children?: ReactNode;
  enabled?: boolean;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}

export function BorderBeam({
  children,
  enabled = true,
  duration = 10,
  className = "",
  style,
}: BorderBeamProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === "undefined") return;

    let visible = false;
    const update = () => setAnimate(visible && document.visibilityState === "visible");
    const observer = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      update();
    });

    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [enabled]);

  return (
    <div
      ref={ref}
      className={`${styles.borderBeamWrapper} ${className}`}
      data-animate={enabled && animate}
      style={{ ...style, "--beam-duration": `${duration}s` } as CSSProperties}
    >
      {children}
    </div>
  );
}

/* =========================================================================
   3. BentoGrid & BentoCard: Asymmetric responsive layout
   ========================================================================= */
export interface BentoGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function BentoGrid({ children, className = "", ...rest }: BentoGridProps) {
  return (
    <div className={`${styles.bentoGrid} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function FiveRowGrid({ children, className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`${styles.fiveRowGrid} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export interface BentoCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  colSpan?: number; // 1 to 12
  rowSpan?: number; // 1 to 4
  tabletColSpan?: number; // 1 to 6
  interactive?: boolean;
  className?: string;
}

export function BentoCard({
  children,
  colSpan,
  rowSpan,
  tabletColSpan,
  interactive = true,
  className = "",
  style,
  onPointerMove,
  ...rest
}: BentoCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (interactive && cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect();
      cardRef.current.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
      cardRef.current.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
    }
    if (onPointerMove) onPointerMove(e);
  };

  const spanStyle: CSSProperties = {
    ...(colSpan
      ? {
          "--bento-col-span": Math.min(12, Math.max(1, colSpan)),
          "--bento-tab-span": tabletColSpan ?? (colSpan >= 8 ? 6 : Math.min(6, Math.max(1, colSpan))),
          gridColumn: `span ${Math.min(12, Math.max(1, colSpan))} / span ${Math.min(
            12,
            Math.max(1, colSpan)
          )}`,
        }
      : {}),
    ...(rowSpan
      ? {
          gridRow: `span ${Math.min(4, Math.max(1, rowSpan))} / span ${Math.min(
            4,
            Math.max(1, rowSpan)
          )}`,
        }
      : {}),
    ...style,
  };

  return (
    <div
      ref={cardRef}
      className={`${styles.bentoCard} ${className}`}
      data-interactive={interactive}
      style={spanStyle}
      onPointerMove={handlePointerMove}
      {...rest}
    >
      {children}
    </div>
  );
}

/* =========================================================================
   4. AnimatedBeam: Visual connection beam between channels and AI
   ========================================================================= */
export interface AnimatedBeamConnectionProps {
  fromLabel: string;
  fromIcon: ReactNode;
  toLabel: string;
  toIcon: ReactNode;
  centerLabel?: string;
  centerIcon?: ReactNode;
  statusLabel?: string;
  className?: string;
}

export function AnimatedBeamConnection({
  fromLabel,
  fromIcon,
  toLabel,
  toIcon,
  centerLabel = "Velora AI",
  centerIcon,
  statusLabel,
  className = "",
}: AnimatedBeamConnectionProps) {
  return (
    <div className={`${styles.animatedBeamContainer} ${className}`}>
      <svg className={styles.beamSvg} preserveAspectRatio="none" viewBox="0 0 400 60">
        <defs>
          <linearGradient id="beamGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#147d73" stopOpacity="0" />
            <stop offset="50%" stopColor="#1a9285" stopOpacity="1" />
            <stop offset="100%" stopColor="#11665f" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Background dashed path */}
        <path d="M 50 30 L 350 30" className={styles.beamPathBg} />
        {/* Animated pulse beam */}
        <path d="M 50 30 L 350 30" className={styles.beamPathActive} />
      </svg>

      {/* From Node */}
      <div className={styles.nodeCircle}>
        <div className={styles.nodeIcon}>{fromIcon}</div>
        <span className={styles.nodeLabel}>{fromLabel}</span>
      </div>

      {/* Center AI Node */}
      <div className={styles.nodeCircle}>
        <div
          className={styles.nodeIcon}
          style={{ background: "#e2f4ef", borderColor: "#147d73" }}
        >
          {centerIcon || (
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#147d73"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          )}
        </div>
        <span className={styles.nodeLabel} style={{ color: "#11665f" }}>
          {centerLabel}
        </span>
        {statusLabel && (
          <span
            style={{
              fontSize: "11px",
              color: "#536762",
              marginTop: "-4px",
            }}
          >
            {statusLabel}
          </span>
        )}
      </div>

      {/* To Node */}
      <div className={styles.nodeCircle}>
        <div className={styles.nodeIcon}>{toIcon}</div>
        <span className={styles.nodeLabel}>{toLabel}</span>
      </div>
    </div>
  );
}
