import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Theater",
};

export default function TheaterPage() {
  return (
    <div className="relative min-h-screen overflow-hidden flex flex-col items-center justify-center">
      {/* Layered ambient lighting */}
      <div className="absolute inset-0 bg-black" />
      <div className="absolute inset-0 bg-gradient-to-b from-accent/[0.03] via-transparent to-accent/[0.02]" />

      {/* Outer radial glow behind the video */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[900px] h-[600px] rounded-[50%] bg-accent/[0.07] blur-[120px]" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[700px] h-[450px] rounded-[50%] bg-blue-500/[0.05] blur-[80px]" />
      </div>

      {/* Edge lighting — top & bottom bars */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent/30 to-transparent" />
      <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent/20 to-transparent" />

      {/* Corner accent lights */}
      <div className="absolute top-0 left-0 w-64 h-64 bg-accent/[0.04] blur-[100px] rounded-full" />
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/[0.04] blur-[100px] rounded-full" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-purple-600/[0.03] blur-[100px] rounded-full" />
      <div className="absolute bottom-0 right-0 w-64 h-64 bg-accent/[0.04] blur-[100px] rounded-full" />

      {/* Video container */}
      <div className="relative z-10 w-full max-w-5xl mx-auto px-4 py-12">
        {/* Video glow frame */}
        <div className="relative group">
          {/* Animated glow ring */}
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-accent/40 via-blue-500/20 to-accent/30 blur-xl opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
          <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-accent/20 via-transparent to-accent/10" />

          {/* The iframe */}
          <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl shadow-accent/10">
            <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
              <iframe
                className="absolute inset-0 w-full h-full"
                src="https://www.youtube.com/embed/2g3Ag0YOVGw?autoplay=1&mute=1"
                title="Armored Core 2 - Intro HD remastered"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>
        </div>

        {/* Title below */}
        <div className="mt-6 text-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground/90">
            Armored Core 2 — Intro HD Remastered
          </h1>
        </div>

        {/* Second video */}
        <div className="relative group mt-12">
          <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-accent/40 via-blue-500/20 to-accent/30 blur-xl opacity-60 group-hover:opacity-80 transition-opacity duration-700" />
          <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-accent/20 via-transparent to-accent/10" />

          <div className="relative bg-black rounded-xl overflow-hidden shadow-2xl shadow-accent/10">
            <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
              <iframe
                className="absolute inset-0 w-full h-full"
                src="https://www.youtube.com/embed/eVAGYyKfo58"
                title="Armored Core 2 Playthrough (No Commentary)"
                frameBorder="0"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <h1 className="text-xl font-bold tracking-tight text-foreground/90">
            Armored Core 2 — Full Playthrough
          </h1>
        </div>

        <p className="text-sm text-muted-foreground mt-8 text-center">
          Theater Mode
        </p>
      </div>
    </div>
  );
}
