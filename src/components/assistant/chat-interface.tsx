"use client";

import { useState, useRef } from "react";
import { Bot, Loader2, Send, User, Paperclip, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AiEngineeringAssistantOutput } from "@/ai/flows/ai-engineering-assistant-flow";
import { getAssistantResponse } from "@/app/actions/assistant-actions";
import { cn } from "@/lib/utils";

type Message = {
  role: "user" | "assistant";
  content: string | AiEngineeringAssistantOutput;
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      const acceptedTypes = ['.stl', '.obj', '.3mf'];
      const fileExtension = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase();
      if (!acceptedTypes.includes(fileExtension)) {
          // Maybe show a toast error here in the future
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
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    const currentFile = file;
    const currentInput = input;
    setInput("");
    setFile(null);

    try {
      const fileDataUri = currentFile ? await toDataURL(currentFile) : undefined;
      
      const assistantResponse = await getAssistantResponse({
          query: currentInput,
          fileName: currentFile?.name,
          fileDataUri: fileDataUri
      });
      
      const assistantMessage: Message = {
        role: "assistant",
        content: assistantResponse,
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
                  <p className="whitespace-pre-wrap">{message.content}</p>
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
        <div className="border-t pt-4">
          {file && (
            <div className="flex items-center justify-between p-2 mb-2 text-sm rounded-md bg-muted">
                <div className="flex items-center gap-2 font-medium truncate">
                    <Paperclip className="w-4 h-4" />
                    <span className="truncate">{file.name}</span>
                </div>
                <Button variant="ghost" size="icon" className="w-6 h-6" onClick={() => setFile(null)} disabled={isLoading}>
                    <X className="w-4 h-4" />
                    <span className="sr-only">Remove file</span>
                </Button>
            </div>
          )}
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
              <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question or upload a model..."
                  disabled={isLoading}
              />
              <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".stl,.obj,.3mf"
                  disabled={isLoading}
              />
              <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoading}
              >
                  <Paperclip className="h-5 w-5" />
                  <span className="sr-only">Attach file</span>
              </Button>
              <Button type="submit" disabled={isLoading || (!input.trim() && !file)}>
                  <Send className="h-5 w-5" />
                  <span className="sr-only">Send</span>
              </Button>
          </form>
        </div>
    </div>
  );
}
