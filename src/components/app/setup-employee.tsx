'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { readEmployeeMotion, subscribeEmployeeMotion } from './employee-motion';
import styles from './setup-employee.module.css';

type EmployeeMedia = { kind: 'video' | 'image'; poster: string; motion: string };
/** Replace this asset slot when the user's transparent animation arrives. */
export const setupEmployeeMedia: EmployeeMedia = {
  kind: 'video', poster: '/media/setup/employee-preview.webp', motion: '/media/setup/employee-introduction.mp4',
};

export function SetupEmployee({ ar, media = setupEmployeeMedia }: { ar: boolean; media?: EmployeeMedia }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const animate = useSyncExternalStore(subscribeEmployeeMotion, readEmployeeMotion, () => false);
  useEffect(() => {
    const player = video.current;
    if (!player || media.kind !== 'video' || failed) return;
    if (!animate) { player.pause(); return; }
    let cancelled = false;
    void player.play().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; player.pause(); };
  }, [animate, media.kind, media.motion, failed]);
  return <div className={styles.figure}>
    {media.kind === 'video' && !failed ? <video ref={video} className={styles.media} autoPlay={animate} muted playsInline loop preload="none" poster={media.poster}
      aria-label={ar ? 'شخصية الموظفة الرقمية' : 'Digital employee character'}
      onError={() => setFailed(true)}>
      <source src={media.motion} type="video/mp4" />
    </video> : <div role="img" aria-label={ar ? 'شخصية الموظفة الرقمية' : 'Digital employee character'} className={`${styles.media} ${styles.image}`} style={{ backgroundImage: `url(${media.kind === 'image' && animate ? media.motion : media.poster})` }} />}
  </div>;
}
