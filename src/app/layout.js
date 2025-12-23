import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});

export const metadata = {
  title: "ResolveOS",
  description: "Collections hub for account management.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} min-h-screen bg-gradient-to-br from-haze via-white to-[#DCEBFF] text-ink antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
