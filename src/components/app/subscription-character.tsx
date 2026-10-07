import Image from "next/image";
import styles from "./subscription-panel.module.css";

type CharacterName = "velora" | "noor" | "lina" | "dana";
const characterAssets: Record<CharacterName, string> = {
  noor: "/characters/1",
  velora: "/characters/2",
  dana: "/characters/3",
  lina: "/characters/4",
};

/** Original transparent character artwork, displayed in full at its native aspect ratio. */
export function SubscriptionCharacter({ name, label, locale, selected = false, size = "staff" }: {
  name: CharacterName;
  label: string;
  locale: "ar" | "en";
  selected?: boolean;
  size?: "host" | "staff";
}) {
  return (
    <div className={styles.characterStage} data-character={name} data-size={size} data-selected={selected}>
      <span className={styles.characterHalo} aria-hidden="true" />
      <span className={styles.characterFloor} aria-hidden="true" />
      <Image
        className={styles.characterImage}
        src={characterAssets[name]}
        alt={locale === "ar" ? `شخصية ${label}` : `${label} character`}
        width={1024}
        height={1536}
        sizes={size === "host" ? "(max-width: 760px) 280px, 420px" : "(max-width: 760px) 160px, 180px"}
        draggable={false}
      />
    </div>
  );
}
