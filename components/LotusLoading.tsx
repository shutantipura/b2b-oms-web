import LotusBrand from "@/components/LotusBrand";

type LotusLoadingProps = {
  message?: string;
  fullScreen?: boolean;
};

/** Reusable Lotus's B2B loading state. No external packages required. */
export default function LotusLoading({
  message = "กำลังเตรียมข้อมูลให้คุณ...",
  fullScreen = true,
}: LotusLoadingProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`flex flex-col items-center justify-center bg-[#F7FAFA] px-6 text-center text-[#173E31] ${
        fullScreen ? "min-h-screen" : "min-h-48 rounded-2xl"
      }`}
    >
      <LotusBrand size="lg" align="center" />

      <div aria-hidden="true" className="mt-8 flex items-center gap-3">
        <span
          className="h-3 w-3 animate-bounce rounded-full bg-[#02B0AF] motion-reduce:animate-none"
          style={{ animationDelay: "-0.32s" }}
        />
        <span
          className="h-3 w-3 animate-bounce rounded-full bg-[#6BD1CA] motion-reduce:animate-none"
          style={{ animationDelay: "-0.16s" }}
        />
        <span className="h-3 w-3 animate-bounce rounded-full bg-[#FDBC16] motion-reduce:animate-none" />
      </div>

      <p className="mt-5 text-sm font-semibold text-[#527F72]">{message}</p>
    </div>
  );
}
