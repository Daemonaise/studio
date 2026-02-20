
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ChatBubble } from "@/components/assistant/chat-bubble";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      <main className="flex-1 bg-background">{children}</main>
      <Footer />
      <ChatBubble />
    </>
  );
}
