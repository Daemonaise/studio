import { AutomotiveQuoteWizard } from "@/components/quote/automotive-quote-wizard";
import { Wand2 } from "lucide-react";

export default function QuotePage() {
  const stats = [
    { value: "8+", label: "Materials" },
    { value: "3", label: "Printers" },
    { value: "< 10s", label: "Quote Time" },
    { value: "STL · OBJ · 3MF", label: "File Formats" },
  ];

  return (
    <div className="relative overflow-hidden">
      {/* Ambient teal glow behind the hero */}
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/5 via-accent/[0.02] to-transparent pointer-events-none" />

      <div className="container py-14 md:py-20">
        <div className="text-center space-y-5 mb-14">

          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
            <Wand2 className="h-3.5 w-3.5" />
            AI-Powered Instant Quoting
          </div>

          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Get Your Part Quote{" "}
            <span className="text-accent">Instantly</span>
          </h1>

          <p className="max-w-2xl mx-auto text-lg text-foreground/65">
            Upload your 3D model, select material and settings — our AI analyzes
            your geometry and returns an accurate price in seconds.
          </p>

          {/* Stats row */}
          <div className="flex flex-wrap justify-center gap-10 pt-3">
            {stats.map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-2xl font-bold text-accent">{value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>

        </div>

        <AutomotiveQuoteWizard />
      </div>
    </div>
  );
}
