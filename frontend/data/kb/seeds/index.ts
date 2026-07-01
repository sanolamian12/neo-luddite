import type { KbDocument } from "@/lib/kb-schema";
import { MASTER_SEEDS } from "./master";
import { FRAMEWORK_SEEDS } from "./frameworks";
import { OCCUPATION_SEEDS } from "./occupations";
import { CASE_SEEDS } from "./cases";
import { GLOSSARY_SEEDS } from "./glossary";
import { PITFALL_SEEDS } from "./pitfalls";

/** 전체 시드 — 카테고리 순서대로 합산. */
export const KB_SEEDS: KbDocument[] = [
  ...MASTER_SEEDS,
  ...FRAMEWORK_SEEDS,
  ...OCCUPATION_SEEDS,
  ...CASE_SEEDS,
  ...GLOSSARY_SEEDS,
  ...PITFALL_SEEDS,
];
