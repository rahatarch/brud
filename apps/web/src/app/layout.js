import { Newsreader } from "next/font/google";

// Stylesheet order is the cascade order: reset, faces, tokens, then layers.
import PressRipple from "@/components/PressRipple";
import SmoothAnchors from "@/components/SmoothAnchors";
import ScrollReveal from "@/components/motion/ScrollReveal";
import SmoothScroll from "@/components/motion/SmoothScroll";
import "./globals.css";
import "../styles/typefaces.css";
import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/nav.css";
import "../styles/hero.css";
/* The hero's device layers, narrowest last so a landscape phone that is also
   tablet-wide gets the phone rules. Each file stands alone; see hero.css. */
import "../styles/hero.tablet.css";
import "../styles/hero.mobile.css";
import "../styles/journey.css";
import "../styles/install.css";
import "../styles/features.css";
import "../styles/guide.css";
import "../styles/faq.css";
import "../styles/sections.tablet.css";
import "../styles/sections.mobile.css";
import "../styles/footer.css";
/* The footer's device layers, narrowest last, same split as the hero. */
import "../styles/footer.tablet.css";
import "../styles/footer.mobile.css";
import "../styles/announcements.css";
import "../styles/banner.css";
import "../styles/contributors.css";
import "../styles/buttons.css";
import "../styles/motion.css";
import "../styles/intro.css";

// Self-hosted and preloaded by Next, so the display face costs no extra
// round trip and never arrives after first paint.
const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-newsreader",
});

export const metadata = {
  title: "Brud Code — Unlimited AI Coding",
  description:
    "Free, open-source VS Code extension that turns any AI chatbot into an agentic coding tool. One paste in, one copy out.",
};

/* The hero entrance, run inline before first paint. It holds the hero
   (`intro`) and starts the CSS entrance (`intro-go`) only once the page has
   finished booting: after `load` and the fonts, and after three calm frames
   in a row, so the first big layout, the GPU's first raster and the bundle's
   start-up all happen while the hero is still dark instead of stuttering the
   entrance. Capped so it never waits more than ~0.9s past load, or 2.6s in
   all. Clears both classes once it has played. Skipped for reduced motion
   and for links that land further down the page. */
const INTRO_SCRIPT = `(function(){
var d=document.documentElement;
if(!window.matchMedia||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
if(location.hash&&location.hash.length>1)return;
d.classList.add('intro');
var done=0;
function go(){if(done)return;done=1;
requestAnimationFrame(function(){requestAnimationFrame(function(){
d.classList.add('intro-go');
setTimeout(function(){d.classList.remove('intro','intro-go')},2400);});});}
function settle(){var last=0,calm=0,t0=performance.now();
function f(t){if(last){calm=t-last<22?calm+1:0;}last=t;
if(calm>=3||t-t0>900)go();else requestAnimationFrame(f);}
requestAnimationFrame(f);}
function ready(){var f=document.fonts&&document.fonts.ready;
if(f)f.then(settle,settle);else settle();}
if(document.readyState==='complete')ready();else window.addEventListener('load',ready);
setTimeout(go,2600);
})();`;

export const viewport = {
  themeColor: "#08090B",
};

export default function RootLayout({ children }) {
  // suppressHydrationWarning: browser extensions (Bitdefender, Grammarly, etc.)
  // inject attributes into the DOM before React hydrates.
  return (
    <html lang="en" className={newsreader.variable} suppressHydrationWarning>
      <head>
        {/* Before first paint: runs the hero entrance (intro.css). */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <SmoothAnchors />
        <SmoothScroll />
        <ScrollReveal />
        <PressRipple />
      </body>
    </html>
  );
}
