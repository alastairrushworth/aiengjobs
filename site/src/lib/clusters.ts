import type { ClusterId } from "@aiengjobs/shared/taxonomy";

export interface ClusterPage {
  id: ClusterId;
  /** URL slug for the programmatic page, e.g. "rag-engineer-jobs" → /rag-engineer-jobs */
  slug: string;
  /** Short label for nav links. */
  label: string;
  h1: string;
  intro: string;
}

// The stack-native landing pages (spec §8). Strict-core AI clusters only.
export const CLUSTER_PAGES: ClusterPage[] = [
  {
    id: "llm",
    slug: "llm-engineer-jobs",
    label: "LLM Engineer",
    h1: "LLM Engineer jobs",
    intro:
      "Roles building with LLM APIs and frameworks — OpenAI/Anthropic, LangChain, LlamaIndex, vLLM, Hugging Face.",
  },
  {
    id: "rag",
    slug: "rag-engineer-jobs",
    label: "RAG / Retrieval",
    h1: "RAG & retrieval engineer jobs",
    intro:
      "Retrieval-augmented generation roles — vector DBs (Pinecone, Weaviate, pgvector, Qdrant), embeddings, reranking.",
  },
  {
    id: "agents",
    slug: "ai-agent-jobs",
    label: "AI Agents",
    h1: "AI agent engineer jobs",
    intro: "Agentic systems roles — tool use, multi-agent orchestration, MCP.",
  },
  {
    id: "evals",
    slug: "ai-eval-jobs",
    label: "Evals & Quality",
    h1: "AI eval & model-quality engineer jobs",
    intro:
      "Model-quality roles — eval harnesses, LLM-as-judge, observability (LangSmith, Arize).",
  },
  {
    id: "inference",
    slug: "inference-engineer-jobs",
    label: "Inference / Serving",
    h1: "Inference & model-serving jobs",
    intro:
      "Serving roles — GPU, Triton, TensorRT, quantization, latency and throughput.",
  },
  {
    id: "finetuning",
    slug: "fine-tuning-jobs",
    label: "Fine-tuning",
    h1: "Fine-tuning engineer jobs",
    intro: "Model-adaptation roles — LoRA/PEFT, RLHF/DPO, distillation.",
  },
];

export const CLUSTER_PAGE_BY_ID: Partial<Record<ClusterId, ClusterPage>> =
  Object.fromEntries(CLUSTER_PAGES.map((p) => [p.id, p]));
