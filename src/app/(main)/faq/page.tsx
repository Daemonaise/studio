import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

const faqs = [
  {
    question: "What file formats do you accept?",
    answer:
      "We accept STL, OBJ, and 3MF files. You can also upload a ZIP archive containing multiple parts.",
  },
  {
    question: "What is the largest part you can print?",
    answer:
      "Our large-format printers can handle parts up to 1 meter × 1 meter × 1 meter. For larger projects, we segment the model into smaller, interlocking parts.",
  },
  {
    question: "What kind of reinforcement is needed?",
    answer:
      "For structural parts like a car body or monocoque, reinforcement is absolutely necessary. We recommend using a fiberglass or carbon fiber overlay to provide the required rigidity and durability. Our team can provide guidance on this process.",
  },
  {
    question: "What does 'show-ready' finish include?",
    answer:
      "A show-ready finish is our highest level of post-processing. It includes sanding all surfaces, filling any imperfections, and applying a high-quality primer, making the part ready for final painting. This option requires a manual quote.",
  },
  {
    question: "How long will my order take?",
    answer:
      "Lead time depends on the size and complexity of your order, the chosen material, and our current production queue. A standard lead time estimate is provided with your quote. Rush options are available.",
  },
  {
    question: "Can you help with the design process?",
    answer:
      "Yes! If you don't have 3D files yet, you can select the 'Request Design Help' option in our quote wizard. Fill out the intake form with as much detail as possible, and our engineering team will get in touch with you.",
  },
];

export default function FAQPage() {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/[0.08] via-accent/[0.03] to-transparent pointer-events-none" />

      {/* Hero */}
      <div className="relative border-b border-border/50">
        <div className="container py-14 md:py-20">
          <div className="text-center space-y-5 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <HelpCircle className="h-3.5 w-3.5" />
              Support
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Frequently Asked{" "}
              <span className="text-accent">Questions</span>
            </h1>
            <p className="text-lg text-foreground/65 leading-relaxed">
              Everything you need to know about our process, materials, and
              turnaround times. Can't find what you're looking for?{" "}
              <a href="/contact" className="text-accent underline-offset-4 hover:underline">
                Contact us.
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="container py-12 md:py-16">
        <div className="max-w-3xl mx-auto">
          <Accordion type="single" collapsible className="w-full space-y-2">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="border border-border/60 rounded-lg px-2 bg-card/50 backdrop-blur-sm data-[state=open]:border-accent/40 data-[state=open]:bg-accent/5 transition-colors duration-200"
              >
                <AccordionTrigger className="text-left hover:no-underline py-4 font-medium">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-foreground/70 leading-relaxed pb-4">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>

          <div className="mt-12 rounded-xl border border-accent/20 bg-accent/5 px-8 py-8 text-center">
            <h3 className="text-lg font-semibold mb-2">Still have questions?</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto mb-5">
              Our team is happy to help. Reach out and we'll get back to you
              as quickly as possible.
            </p>
            <a
              href="/contact"
              className="inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "hsl(var(--accent))",
                color: "hsl(var(--accent-foreground))",
              }}
            >
              Get in Touch
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
