import Image from "next/image";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AuthArea } from "@/components/AuthArea";
import { ChatView } from "@/components/chat/ChatView";
import titleImage from "@/assets/title.png";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (session) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <ChatView />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-10">
        <div className="w-full max-w-md text-center">
          <Image
            src={titleImage}
            alt="Dewey"
            width={240}
            height={240}
            className="mx-auto rounded-xl object-contain mb-5"
            priority
          />
          <p className="text-dewey-mute text-sm sm:text-base mb-6 max-w-sm mx-auto">
            Your AI coach for educational leadership.
            <br />
            Reflect, plan, and lead with clarity.
          </p>
          <AuthArea />
        </div>
      </main>

      <footer className="border-t border-dewey-border py-4">
        <div className="max-w-4xl mx-auto px-4 text-center text-xs text-dewey-mute">
          Sign in with SSO or your Dewey account.
        </div>
      </footer>
    </div>
  );
}
