type LotusBrandProps = {
  size?: "sm" | "md" | "lg";
  align?: "left" | "center";
  showSlogan?: boolean;
  className?: string;
};

const FONT_SIZES = {
  sm: "text-xl",
  md: "text-[28px]",
  lg: "text-3xl",
} as const;

/** One shared Lotus's B2B wordmark and slogan across customer and staff screens. */
export default function LotusBrand({
  size = "md",
  align = "left",
  showSlogan = true,
  className = "",
}: LotusBrandProps) {
  return (
    <div className={[(align === "center" ? "text-center" : "text-left"), className].filter(Boolean).join(" ")}>
      <div
        aria-label="Lotus’s B2B"
        className={["whitespace-nowrap font-black tracking-tight leading-tight text-[#02B0AF]", FONT_SIZES[size]].join(" ")}
      >
        Lotus<span className="text-[#FDBC16]">’s</span>
        <span className="ml-[0.28em] font-black text-[#17453F]">B2B</span>
      </div>
      {showSlogan && (
        <p className="mt-1 text-[11px] font-semibold leading-tight text-[#82968D]">
          เพื่อธุรกิจที่ไปได้ไกลกว่า
        </p>
      )}
    </div>
  );
}
