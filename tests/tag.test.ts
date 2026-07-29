import { describe, expect, it } from "vitest";
import { tagHeuristic } from "../engine/src/pipeline/tag.ts";

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

describe("tagHeuristic evidence gate", () => {
  const text =
    "Backend services in Python on AWS. You will integrate machine learning models built by data science.";

  it("emits only skills literally present in the text", () => {
    const { skills } = tagHeuristic(text);
    expect(skills).toEqual(expect.arrayContaining(["Python", "AWS"]));
    expect(skills).not.toContain("GPU");
    expect(skills).not.toContain("vLLM");
    expect(skills).not.toContain("Pinecone");
  });

  it("picks up serving-stack terms when they are mentioned", () => {
    const { skills } = tagHeuristic("We serve models with vLLM on GPU clusters.");
    expect(skills).toContain("vLLM");
    expect(skills).toContain("GPU");
  });

  it("rolls up clusters only from evidenced skills", () => {
    const { clusters } = tagHeuristic(text);
    expect(clusters).not.toContain("rag");
  });
});
