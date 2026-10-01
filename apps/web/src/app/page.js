import FaqSection from "@/components/faq/FaqSection";
import FeaturesSection from "@/components/features/FeaturesSection";
import FooterSection from "@/components/footer/FooterSection";
import GuideSection from "@/components/guide/GuideSection";
import Hero from "@/components/hero/Hero";
import InstallSection from "@/components/install/InstallSection";
import HeroPortal from "@/components/journey/HeroPortal";
import Journey from "@/components/journey/Journey";
import StarContributorBanner from "@/components/hero/StarContributorBanner";

export default function Home() {
  return (
    <>
      <StarContributorBanner />
      <main>
        {/* The hero pins while you scroll; the Install section is revealed
            through the mark. The copy inside the portal is visual only. */}
        <Journey>
          <Hero
            portal={
              <HeroPortal>
                <InstallSection decorative />
              </HeroPortal>
            }
          />
        </Journey>
        <InstallSection />
        <FeaturesSection />
        <GuideSection />
        <FaqSection />
      </main>

      <FooterSection />
    </>
  );
}
