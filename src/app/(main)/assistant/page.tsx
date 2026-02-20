
import { ChatInterface } from "@/components/assistant/chat-interface";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot } from "lucide-react";

export default function AssistantPage() {
  return (
    <div className="bg-secondary/50">
      <div className="container py-12 md:py-20">
        <div className="text-center space-y-4 mb-12">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            AI Engineering Assistant
          </h1>
          <p className="max-w-3xl mx-auto text-lg text-foreground/70">
            Get instant, expert advice on material selection for your 3D printing needs.
            Ask about trade-offs between strength, print time, and cost.
          </p>
        </div>
        <Card className="w-full max-w-3xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot /> AI Engineering Assistant
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChatInterface />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
