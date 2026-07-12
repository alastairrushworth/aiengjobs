import { describe, expect, it } from "vitest";
import { combineSkills, tagHeuristic } from "../engine/src/pipeline/tag.ts";

describe("tagHeuristic", () => {
  it("matches taxonomy terms on word boundaries only", () => {
    const { skills } = tagHeuristic("We use RAG pipelines and Go services with lots of storage.");
    expect(skills).toContain("RAG");
    expect(skills).toContain("Go");
    expect(skills).not.toContain("Rust"); // not mentioned
  });

  it("matches synonym variants as evidence", () => {
    const { skills } = tagHeuristic(
      "Experience with HuggingFace, embedding models, function calling, and building evals.",
    );
    expect(skills).toContain("Hugging Face");
    expect(skills).toContain("Embeddings");
    expect(skills).toContain("Tool use");
    expect(skills).toContain("Eval harnesses");
  });

  it("does not treat company-name boilerplate as API-skill evidence", () => {
    const { skills } = tagHeuristic(
      "About Anthropic: we build Claude. Competitors include OpenAI.",
    );
    expect(skills).not.toContain("Anthropic API");
    expect(skills).not.toContain("OpenAI API");
  });
});

describe("combineSkills", () => {
  const text =
    "Backend services in Python on AWS. You will integrate machine learning models built by data science.";

  it("drops LLM-proposed skills with no textual evidence (enum-spraying guard)", () => {
    const { skills } = combineSkills(text, ["GPU", "Latency", "vLLM", "Pinecone", "Python"]);
    expect(skills).toEqual(expect.arrayContaining(["Python", "AWS"]));
    expect(skills).not.toContain("GPU");
    expect(skills).not.toContain("vLLM");
    expect(skills).not.toContain("Pinecone");
  });

  it("keeps LLM skills that do appear in the text", () => {
    const { skills } = combineSkills("We serve models with vLLM on GPU clusters.", ["vLLM", "GPU"]);
    expect(skills).toContain("vLLM");
    expect(skills).toContain("GPU");
  });

  it("rolls up clusters only from evidenced skills", () => {
    const { clusters } = combineSkills(text, ["Weaviate", "Qdrant", "Milvus"]);
    expect(clusters).not.toContain("rag");
  });
});
