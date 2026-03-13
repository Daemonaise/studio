"use client";

import { useState, useRef, useEffect } from "react";
import { Bot, Loader2, Send, User, Paperclip, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiEngineeringAssistantOutput } from "@/ai/flows/ai-engineering-assistant-flow";
import { getAssistantResponse } from "@/app/actions/assistant-actions";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string;
};

// Helper to convert file to data URI
const toDataURL = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const acceptedTypes = ['.stl', '.obj', '.3mf', '.amf'];
      const fileExtension = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase();
      if (!acceptedTypes.includes(fileExtension)) {
        console.error("Invalid file type for assistant");
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !file) return;

    let userMessageContent = input;
    if (file) {
      userMessageContent += `\n(Attached file: ${file.name})`;
    }

    const userMessage: Message = { role: "user", content: userMessageContent };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsLoading(true);

    const currentFile = file;
    const currentInput = input;
    setInput("");
    setFile(null);

    try {
      const fileDataUri = currentFile ? await toDataURL(currentFile) : undefined;

      // Pass conversation history (last 20 messages to stay within token limits)
      const history = updatedMessages.slice(-20).map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      }));

      const assistantResponse = await getAssistantResponse({
        query: currentInput,
        fileName: currentFile?.name,
        fileDataUri,
        history: history.slice(0, -1), // exclude the current query (it's passed separately)
      });

      const assistantMessage: Message = {
        role: "assistant",
        content: assistantResponse.response,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error(error);
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
      <div ref={scrollRef} className="flex-grow space-y-4 h-[400px] overflow-y-auto pr-4 mb-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 py-8">
            <Bot className="h-8 w-8 text-accent/50" />
            <p className="text-sm">Ask me about materials, print settings, part orientation, or upload a model for analysis.</p>
          </div>
        )}
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              "flex items-start gap-3",
              message.role === "user" ? "justify-end" : ""
            )}
          >
            {message.role === "assistant" && (
              <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                <AvatarFallback className="bg-accent/10 text-accent"><Bot size={16} /></AvatarFallback>
              </Avatar>
            )}
            <div
              className={cn(
                "rounded-lg px-4 py-2.5 max-w-[85%] text-sm leading-relaxed",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              )}
            >
              <div className="whitespace-pre-wrap break-words prose-sm">{message.content}</div>
            </div>
            {message.role === "user" && (
              <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                <AvatarFallback><User size={16} /></AvatarFallback>
              </Avatar>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex items-start gap-3">
            <Avatar className="h-7 w-7 shrink-0 mt-0.5">
              <AvatarFallback className="bg-accent/10 text-accent"><Bot size={16} /></AvatarFallback>
            </Avatar>
            <div className="rounded-lg px-4 py-2.5 bg-muted flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              <span className="text-muted-foreground">Thinking...</span>
            </div>
          </div>
        )}
      </div>
      <div className="border-t pt-3">
        {file && (
          <div className="flex items-center justify-between p-2 mb-2 text-xs rounded-md bg-muted">
            <div className="flex items-center gap-2 font-medium truncate">
              <Paperclip className="w-3.5 h-3.5" />
              <span className="truncate">{file.name}</span>
            </div>
            <Button variant="ghost" size="icon" className="w-5 h-5" onClick={() => setFile(null)} disabled={isLoading}>
              <X className="w-3.5 h-3.5" />
              <span className="sr-only">Remove file</span>
            </Button>
          </div>
        )}
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about materials, settings, or upload a model..."
            disabled={isLoading}
            className="text-sm"
          />
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="sr-only"
            accept=".stl,.obj,.3mf,.amf"
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="shrink-0"
          >
            <Paperclip className="h-4 w-4" />
            <span className="sr-only">Attach file</span>
          </Button>
          <Button type="submit" disabled={isLoading || (!input.trim() && !file)} className="shrink-0">
            <Send className="h-4 w-4" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
