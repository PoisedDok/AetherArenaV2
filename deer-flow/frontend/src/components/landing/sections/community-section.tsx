"use client";

import Link from "next/link";

import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";

import { Section } from "../section";

export function CommunitySection() {
  return (
    <Section
      title={
        <AuroraText colors={["#60A5FA", "#A5FA60", "#A560FA"]}>
          Get started
        </AuroraText>
      }
      subtitle="Open the workspace to chat with your assistant and pick up where you left off."
    >
      <div className="flex justify-center">
        <Button className="text-xl" size="lg" asChild>
          <Link href="/workspace">Open workspace</Link>
        </Button>
      </div>
    </Section>
  );
}
