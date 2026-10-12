import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "../src/style.css";
export const metadata: Metadata = { title: "Wayfarer — Your travel companion", description: "Your trip, beautifully in order. A private daily travel companion.", icons: {icon: "/favicon.svg"} };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
