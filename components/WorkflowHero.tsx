export function WorkflowHero() {
  return (
    <section className="relative w-full py-8 md:py-10" style={{ overflowX: "clip", overflowY: "visible" }}>
      <style>{`
        @keyframes hero-fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .hero-label {
          animation: hero-fade-up 0.5s cubic-bezier(.22,1,.36,1) 0.1s both;
        }
        .hero-title {
          animation: hero-fade-up 0.6s cubic-bezier(.22,1,.36,1) 0.25s both;
        }
      `}</style>

      <div className="relative left-1/2 h-[210px] w-[1800px] -translate-x-1/2 sm:h-[300px]">
        <svg
          className="pointer-events-none absolute inset-0 hidden size-full text-white/25 md:block"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <path d="M12.142472585042317 17.524371676974827 C18.142472585042317 17.524371676974827 19.31540764702691 38.08842694317853 25.31540764702691 38.08842694317853" stroke="currentColor" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          <path d="M13.886519961886936 68.53964346426504 C19.886519961886936 68.53964346426504 19.31540764702691 38.08842694317853 25.31540764702691 38.08842694317853" stroke="currentColor" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          <path d="M32.083896213107636 40.45323972348814 C38.083896213107636 40.45323972348814 31.833333333333336 35.92592592592593 37.833333333333336 35.92592592592593" stroke="currentColor" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          <path d="M62.16666666666667 35.92592592592593 C68.16666666666667 35.92592592592593 61.273810492621536 42.835961801034436 67.27381049262154 42.835961801034436" stroke="currentColor" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          <path d="M77.04563395182291 40.561028939706304 C83.04563395182291 40.561028939706304 80.06401231553819 75.87050261320891 86.06401231553819 75.87050261320891" stroke="currentColor" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
        </svg>

        {/* Card 1 */}
        <div className="absolute cursor-grab select-none touch-none active:cursor-grabbing hidden rotate-2 md:block" style={{ left: "6.7%", top: "0.61%", zIndex: 1 }}>
          <div className="drop-shadow-[0_4px_14px_rgba(0,0,0,0.24)]">
            <div className="flex items-center gap-[2px]">
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
              <div className="rounded-[13px] p-[3px] shadow-[inset_0.3px_0.3px_0.3px_rgba(255,255,255,0.12)] bg-white/[0.08]">
                <div className="relative overflow-hidden rounded-[10px]" style={{ width: 82, height: 82 }}>
                  <img alt="" draggable={false} loading="eager" className="absolute inset-0 size-full object-cover rounded-[10px]" src="/1.webp" />
                </div>
              </div>
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="absolute cursor-grab select-none touch-none active:cursor-grabbing hidden rotate-3 md:block" style={{ left: "25.2%", top: "8.16%", zIndex: 4 }}>
          <div className="drop-shadow-[0_4px_14px_rgba(0,0,0,0.24)]">
            <div className="flex items-center gap-[2px]">
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
              <div className="rounded-[13px] p-[3px] shadow-[inset_0.3px_0.3px_0.3px_rgba(255,255,255,0.12)] bg-white/20">
                <div className="relative overflow-hidden rounded-[10px]" style={{ width: 108, height: 162 }}>
                  <img alt="" draggable={false} loading="eager" className="absolute inset-0 size-full object-cover rounded-[10px]" src="/2.webp" />
                </div>
              </div>
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="absolute cursor-grab select-none touch-none active:cursor-grabbing hidden -rotate-2 sm:block" style={{ left: "67.16%", top: "20.96%", zIndex: 6 }}>
          <div className="drop-shadow-[0_4px_14px_rgba(0,0,0,0.24)]">
            <div className="flex items-center gap-[2px]">
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
              <div className="rounded-[13px] p-[3px] shadow-[inset_0.3px_0.3px_0.3px_rgba(255,255,255,0.12)] bg-white/20">
                <div className="relative overflow-hidden rounded-[10px]" style={{ width: 162, height: 106 }}>
                  <img alt="" draggable={false} loading="eager" className="absolute inset-0 size-full object-cover rounded-[10px]" src="/3.webp" />
                </div>
              </div>
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
            </div>
          </div>
        </div>

        {/* Card 4 */}
        <div className="absolute cursor-grab select-none touch-none active:cursor-grabbing hidden -rotate-2 lg:block" style={{ left: "85.95%", top: "55%", zIndex: 8 }}>
          <div className="drop-shadow-[0_4px_14px_rgba(0,0,0,0.24)]">
            <div className="flex items-center gap-[2px]">
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
              <div className="rounded-[13px] p-[3px] shadow-[inset_0.3px_0.3px_0.3px_rgba(255,255,255,0.12)] bg-white/[0.08]">
                <div className="relative overflow-hidden rounded-[10px]" style={{ width: 178, height: 100 }}>
                  <img alt="" draggable={false} loading="eager" className="absolute inset-0 size-full object-cover rounded-[10px]" src="/4.webp" />
                </div>
              </div>
              <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
            </div>
          </div>
        </div>

        {/* Card: text prompt */}
        <div className="absolute cursor-grab select-none touch-none active:cursor-grabbing hidden -rotate-2 md:block" style={{ left: "6%", top: "55%", zIndex: 2 }}>
          <div className="flex items-center gap-[2px]">
            <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
            <div className="w-[132px] rounded-[10px] bg-[linear-gradient(126deg,rgba(255,255,255,0.03)_2%,rgba(255,255,255,0.10)_98%)] p-[6px] shadow-[inset_-0.2px_0.2px_0.2px_rgba(255,255,255,0.5)]">
              <p className="line-clamp-6 text-[8px] leading-[11px] font-medium text-white/50">
                Generate stunning AI images and videos with customizable workflows. Connect nodes, set parameters, and create at scale.
              </p>
            </div>
            <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
          </div>
        </div>

        {/* Central hero card */}
        <div
          className="absolute cursor-grab select-none touch-none active:cursor-grabbing"
          style={{ left: "50%", top: "10%", transform: "translateX(-50%)", zIndex: 5 }}
        >
          <div className="flex items-center gap-[2px]">
            <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
            <div className="relative flex w-[min(430px,calc(100vw-48px))] flex-col items-center justify-center gap-2 py-4 text-center">
              {/* Selected-node frame: lime outline with corner handles */}
              <div className="pointer-events-none absolute inset-0 rounded-lg border-[1.5px] border-(--c-accent)" />
              <span className="pointer-events-none absolute -left-[3px] -top-[3px] size-[6px] rounded-[1px] bg-(--c-accent)" />
              <span className="pointer-events-none absolute -right-[3px] -top-[3px] size-[6px] rounded-[1px] bg-(--c-accent)" />
              <span className="pointer-events-none absolute -bottom-[3px] -left-[3px] size-[6px] rounded-[1px] bg-(--c-accent)" />
              <span className="pointer-events-none absolute -bottom-[3px] -right-[3px] size-[6px] rounded-[1px] bg-(--c-accent)" />
              <p className="hero-label text-[12px] leading-5 font-semibold tracking-[0.14em] uppercase whitespace-nowrap text-(--c-text-3)">
                CactusGen
              </p>
              <h1 className="hero-title cg-display px-4 text-[34px] text-(--c-text) md:text-[46px]">
                Build AI workflows<br />and generate stunning media
              </h1>
            </div>
            <span className="size-1 shrink-0 rounded-full border border-black/25 bg-[linear-gradient(180deg,#9a9a9a_0%,#6b6b6b_100%)]" />
          </div>
        </div>
      </div>
    </section>
  );
}
