
"use client";

import { useState } from "react";
import { Bot, Loader2, Send, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiEngineeringAssistant, AiEngineeringAssistantOutput } from "@/ai/flows/ai-engineering-assistant-flow";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string | AiEngineeringAssistantOutput;
};

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setInput("");

    try {
      const assistantResponse = await aiEngineeringAssistant({ query: input });
      const assistantMessage: Message = {
        role: "assistant",
        content: assistantResponse,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-grow space-y-4 h-[400px] overflow-y-auto pr-4 mb-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn(
                "flex items-start gap-4",
                message.role === "user" ? "justify-end" : ""
              )}
            >
              {message.role === "assistant" && (
                <Avatar className="h-8 w-8">
                  <AvatarFallback><Bot size={20} /></AvatarFallback>
                </Avatar>
              )}
              <div
                className={cn(
                  "rounded-lg px-4 py-2 max-w-[80%]",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                )}
              >
                {typeof message.content === 'string' ? (
                  <p>{message.content}</p>
                ) : (
                  <div className="space-y-2">
                    <p className="font-semibold">Recommendations:</p>
                    <p>{message.content.recommendations}</p>
                    <p className="font-semibold mt-2">Trade-Offs:</p>
                    <p>{message.content.tradeOffExplanation}</p>
                  </div>
                )}
              </div>
              {message.role === "user" && (
                <Avatar className="h-8 w-8">
                   <AvatarFallback><User size={20} /></AvatarFallback>
                </Avatar>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="flex items-start gap-4">
               <Avatar className="h-8 w-8">
                  <AvatarFallback><Bot size={20} /></AvatarFallback>
                </Avatar>
              <div className="rounded-lg px-4 py-2 bg-muted flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span>Analyzing...</span>
              </div>
            </div>
          )}
        </div>
        <form onSubmit={handleSendMessage} className="flex items-center gap-2 border-t pt-4">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g., 'What's the best material...?'"
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
            <Send className="h-5 w-5" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
    </div>
  );
}
