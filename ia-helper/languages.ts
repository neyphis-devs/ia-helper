import fs from "fs";
import path from "path";

interface LanguageEntry {
  welcome: string;
  transferred: string;
  failure: string;
  error: string;
}

interface LanguageMap {
  [lang: string]: LanguageEntry;
}

const filePath = path.resolve(__dirname, "languages.json");
const raw = fs.readFileSync(filePath, "utf-8");
const translations: LanguageMap = JSON.parse(raw);


export function getMessage(lang: string, key: keyof LanguageEntry, variables: Record<string, string> = {}): string {
  const base = translations[lang]?.[key] || translations["fr"][key] || "❌ Message non défini.";
  return base.replace(/{{(.*?)}}/g, (_, varName) => variables[varName] || "");
}
