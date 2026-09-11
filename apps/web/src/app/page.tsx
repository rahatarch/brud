import CornerElements from "@/components/corner-elements";

export default function Home() {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[var(--color-light-bg)] p-12 md:p-20">
      <CornerElements />
      <div className="relative z-10 w-full max-w-[800px] text-center">
        <h1 className="text-3xl md:text-5xl font-extrabold leading-[1.1] tracking-tight text-[var(--color-light-text)]">
          Stop hand-copying AI code changes into your files.
        </h1>
        <p className="mt-6 text-sm md:text-base leading-[1.75] text-[var(--color-light-text-secondary)]">
          Brud Code connects your AI chatbot to your editor. Paste once, review the diff, apply with one click. No API keys. No subscriptions.
        </p>
        <div className="mt-8">
          <a
            href="#"
            className="inline-flex items-center rounded-lg bg-[var(--color-primary)] px-6 py-3 text-base font-semibold text-white transition-colors duration-200 hover:bg-[var(--color-primary-hover)]"
          >
            Install for VS Code
          </a>
        </div>
      </div>
    </div>
  );
}