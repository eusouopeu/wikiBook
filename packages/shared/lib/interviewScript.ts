// ─────────────────────────────────────────────────────────────────────────────
// packages/shared/lib/interviewScript.ts
// Roteiro FIXO de entrevista de nivelamento (não decidido pelo Claude — mais
// barato e previsível). Perguntas genéricas o bastante para qualquer
// objetivo ("violão", "alemão", "calistenia"...); só a última etapa manda as
// respostas ao Claude para consolidar um perfil em texto curto (ver
// path:consolidateProfile). Puramente client-side, sem IPC.
// ─────────────────────────────────────────────────────────────────────────────

export interface InterviewQuestion {
  id: string;
  prompt: (goal: string) => string;
  type: "choice" | "text";
  options?: string[];
  placeholder?: string;
}

export const INTERVIEW_SCRIPT: InterviewQuestion[] = [
  {
    id: "experience",
    type: "choice",
    prompt: (goal) => `Você já tem alguma experiência com "${goal}", mesmo que pouca?`,
    options: ["Nenhuma — estou começando do zero", "Um pouco, de forma informal", "Já estudei antes, mas parei", "Tenho uma base razoável"],
  },
  {
    id: "goal3months",
    type: "text",
    prompt: (goal) => `Em 3 meses, o que você gostaria de conseguir fazer com "${goal}"? Seja concreto.`,
    placeholder: "Ex.: tocar 3 músicas inteiras de cor",
  },
  {
    id: "weeklyTime",
    type: "choice",
    prompt: () => "Quanto tempo por semana você consegue dedicar a isso, de forma realista?",
    options: ["Até 1 hora", "1 a 3 horas", "3 a 6 horas", "Mais de 6 horas"],
  },
  {
    id: "resources",
    type: "text",
    prompt: (goal) => `Que recursos/condições você já tem para "${goal}"? (equipamento, espaço, acesso, etc.)`,
    placeholder: "Ex.: tenho um violão em casa, sem professor",
  },
  {
    id: "format",
    type: "choice",
    prompt: () => "Você prefere aprender mais por vídeo (demonstração visual) ou por texto (leitura estruturada)?",
    options: ["Principalmente vídeo", "Principalmente texto", "Equilíbrio entre os dois"],
  },
  {
    id: "obstacles",
    type: "text",
    prompt: () => "Alguma dificuldade específica que você já sabe que vai enfrentar (física, de tempo, de disciplina)?",
    placeholder: "Ex.: costumo perder a motivação depois de 2 semanas",
  },
];
