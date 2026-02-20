
"use client";

import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChatInterface } from "./chat-interface";
import { Separator } from "../ui/separator";

export function ChatBubble() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          className="fixed bottom-6 right-6 h-16 w-16 rounded-full shadow-lg"
          size="icon"
          style={{
            backgroundColor: "hsl(var(--accent))",
            color: "hsl(var(--accent-foreground))",
          }}
        >
          <Bot className="h-8 w-8" />
          <span className="sr-only">Open AI Assistant</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[440px] mr-4 p-0" align="end">
        <div className="p-4">
             <h3 className="font-semibold flex items-center gap-2 text-lg"><Bot size={20} /> AI Engineering Assistant</h3>
        </div>
        <Separator />
        <div className="p-4">
            <ChatInterface />
        </div>
      </PopoverContent>
    </Popover>
  );
}
