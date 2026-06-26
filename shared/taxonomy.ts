// Stack-native skill taxonomy (spec §4). Single source of truth shared by the
// ingestion engine (skill tagging) and the Astro site (browse facets).

export type ClusterId =
  | "llm"
  | "rag"
  | "agents"
  | "evals"
  | "inference"
  | "finetuning"
  | "core_ml"
  | "mlops"
  | "cloud"
  | "language";

export interface SkillCluster {
  id: ClusterId;
  label: string;
  /** Canonical skill names that belong to this cluster (used for tagging + facets). */
  skills: string[];
}

export const CLUSTERS: SkillCluster[] = [
  {
    id: "llm",
    label: "LLM & frameworks",
    skills: [
      "OpenAI API", "Anthropic API", "LangChain", "LlamaIndex", "DSPy",
      "vLLM", "Hugging Face",
    ],
  },
  {
    id: "rag",
    label: "Retrieval / RAG",
    skills: [
      "RAG", "Pinecone", "Weaviate", "pgvector", "Qdrant", "Milvus",
      "Embeddings", "Reranking",
    ],
  },
  {
    id: "agents",
    label: "Agents",
    skills: ["Tool use", "Multi-agent", "Orchestration", "MCP"],
  },
  {
    id: "evals",
    label: "Evals & quality",
    skills: ["Eval harnesses", "LLM-as-judge", "LangSmith", "Arize", "Observability"],
  },
  {
    id: "inference",
    label: "Inference / serving",
    skills: ["GPU", "Triton", "TensorRT", "Quantization", "Latency", "Throughput"],
  },
  {
    id: "finetuning",
    label: "Fine-tuning",
    skills: ["LoRA", "PEFT", "RLHF", "DPO", "Distillation"],
  },
  {
    id: "core_ml",
    label: "Core ML",
    skills: ["PyTorch", "TensorFlow", "Deep learning", "NLP", "Computer vision"],
  },
  {
    id: "mlops",
    label: "MLOps / infra",
    skills: [
      "Kubernetes", "Docker", "Ray", "Kubeflow", "SageMaker", "Vertex AI",
      "Azure ML", "CI/CD",
    ],
  },
  {
    id: "cloud",
    label: "Cloud",
    skills: ["AWS", "Azure", "GCP"],
  },
  {
    id: "language",
    label: "Languages",
    skills: ["Python", "TypeScript", "JavaScript", "Go", "Rust", "C++"],
  },
];

export const CLUSTER_BY_ID: Record<ClusterId, SkillCluster> = Object.fromEntries(
  CLUSTERS.map((c) => [c.id, c]),
) as Record<ClusterId, SkillCluster>;

/** Map a canonical skill name back to its cluster id (lower-cased lookup). */
export const CLUSTER_OF_SKILL: Record<string, ClusterId> = Object.fromEntries(
  CLUSTERS.flatMap((c) => c.skills.map((s) => [s.toLowerCase(), c.id])),
);
