"use client";

import { Logo } from "@/components/icons";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    question: "What file formats do you accept?",
    answer:
      "We accept STL, OBJ, and 3MF files. You can also upload a ZIP archive containing multiple parts.",
  },
  {
    question: "What is the largest part you can print?",
    answer:
      "Our large-format printers can handle parts up to 1 meter x 1 meter x 1 meter. For larger projects, we segment the model into smaller, interlocking parts.",
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

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t">
      {/* FAQ Section */}
      <div className="container py-12 md:py-16">
        <div className="text-center space-y-2 mb-8">
          <h2 className="text-2xl font-bold tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="text-sm text-muted-foreground">
            Have questions? We&apos;ve got answers.
          </p>
        </div>
        <div className="max-w-3xl mx-auto">
          <Accordion type="single" collapsible className="w-full">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t">
        <div className="container flex flex-col items-center justify-between gap-4 py-6 md:h-16 md:flex-row md:py-0">
          <div className="flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
            <Logo className="h-6 w-6" />
            <p className="text-center text-sm leading-loose md:text-left">
              &copy; {year} Karasawa Labs. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
