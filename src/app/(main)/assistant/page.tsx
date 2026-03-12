import { ChatInterface } from "@/components/assistant/chat-interface";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, Sparkles } from "lucide-react";

export default function AssistantPage() {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-accent/[0.08] via-accent/[0.03] to-transparent pointer-events-none" />

      {/* Hero */}
      <div className="relative border-b border-border/50">
        <div className="container py-14 md:py-20">
          <div className="text-center space-y-5 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-1.5 text-sm font-medium text-accent">
              <Sparkles className="h-3.5 w-3.5" />
              AI-Powered
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
              Engineering{" "}
              <span className="text-accent">Assistant</span>
            </h1>
            <p className="text-lg text-foreground/65 leading-relaxed">
              Get instant expert advice on material selection, print settings,
              and design trade-offs — powered by Gemini AI.
            </p>
          </div>
        </div>
      </div>

      <div className="container py-12 md:py-16">
        <div className="w-full max-w-3xl mx-auto">
          <div className="group relative rounded-lg">
            <div className="absolute -inset-0.5 rounded-lg bg-gradient-to-br from-primary/70 via-accent/70 to-secondary/70 opacity-20 blur-xl transition-opacity duration-300 group-hover:opacity-60" />
            <Card className="relative teal-frame">
              <div className="flex items-center gap-2.5 px-6 pt-5 pb-3 border-b border-border/50">
                <div className="rounded-full bg-accent/10 border border-accent/20 p-1.5">
                  <Bot className="h-4 w-4 text-accent" />
                </div>
                <span className="font-semibold text-sm">AI Engineering Assistant</span>
                <span className="ml-auto text-xs text-accent bg-accent/10 border border-accent/20 rounded-full px-2 py-0.5">
                  Online
                </span>
              </div>
              <CardContent className="p-0">
                <ChatInterface />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
