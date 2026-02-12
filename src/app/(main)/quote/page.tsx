import { QuoteWizard } from "@/components/quote/quote-wizard";

export default function QuotePage() {
  return (
    <div>
      <div className="container py-12 md:py-20">
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Get an Instant Quote
          </h1>
          <p className="max-w-3xl mx-auto text-lg text-foreground/70">
            Follow the steps below to configure your part and receive an instant estimate.
          </p>
        </div>
        <QuoteWizard />
      </div>
    </div>
  );
}
