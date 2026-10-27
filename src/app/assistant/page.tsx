import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import AssistantChat from "@/components/assistant/AssistantChat";
import { loadAiConfig, modelConfigured } from "@/lib/ai/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("assistant");
  return { title: t("title"), description: t("subtitle") };
}

/**
 * AI assistant page. The chat itself runs entirely through
 * /api/assistant; `available` only controls the upfront notice when no
 * model is configured (sending a message would return the same
 * information as a structured error).
 */
export default async function AssistantPage() {
  const t = await getTranslations("assistant");
  const available = modelConfigured(loadAiConfig());
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mx-auto mb-6 max-w-3xl text-center">
        <h1 className="text-3xl font-extrabold">{t("title")}</h1>
        <p className="mt-2 text-slate-500">{t("subtitle")}</p>
      </header>
      <AssistantChat available={available} />
    </main>
  );
}
