import type { ClusterId } from "@aiengjobs/shared/taxonomy";

// Slice size moved to lib/landings.ts as PAGE_SIZE — location pages paginate
// through the same route, so the constant can't live in the cluster module.

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
  {
    id: "mlops",
    slug: "mlops-engineer-jobs",
    label: "MLOps / Infra",
    h1: "MLOps & ML infrastructure jobs",
    intro:
      "Roles running models in production — Kubernetes, Ray, Kubeflow, SageMaker/Vertex, CI/CD for ML.",
  },
  {
    id: "core_ml",
    slug: "machine-learning-engineer-jobs",
    label: "Core ML",
    h1: "Machine learning engineer jobs",
    intro:
      "Classical and deep-learning roles — PyTorch, TensorFlow, NLP, computer vision.",
  },
];

// `cloud` and `language` from shared/taxonomy.ts deliberately get no page.
// They tag by ambient tooling (AWS/GCP, Python/Go) rather than by what the job
// is about: `language` alone covers ~75% of the board, so its page would be a
// near-duplicate of the homepage, and both would compete with the pages above
// for the same roles without describing a distinct kind of work.
