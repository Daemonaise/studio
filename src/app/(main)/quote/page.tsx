
import { AutomotiveQuoteWizard } from "@/components/quote/automotive-quote-wizard";

export default function QuotePage() {
  return (
    <div>
      <div className="container py-12 md:py-20">
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Automotive Quote
          </h1>
          <p className="max-w-3xl mx-auto text-lg text-foreground/70">
            Configure your automotive project and get an instant estimate.
          </p>
        </div>
        <AutomotiveQuoteWizard />
      </div>
    </div>
  );
}
