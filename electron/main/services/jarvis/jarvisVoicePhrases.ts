const ASK_REPEAT = [
  'Não entendi, consegue repetir?',
  'Desculpa, não peguei direito. Pode repetir?',
  'Hmm, não entendi bem. Repete pra mim?',
] as const;

const LISTENING_OK = [
  'Sim, estou te ouvindo.',
  'Pode falar, estou aqui.',
  'Estou ouvindo, manda ver.',
] as const;

const ACK = [
  'Entendido.',
  'Beleza, deixa comigo.',
  'Certo, vou cuidar disso.',
  'Ok, já vou fazer.',
] as const;

const PROJECT_NOT_FOUND = [
  'Não achei esse projeto. Qual o nome certinho?',
  'Hmm, não encontrei esse projeto. Pode repetir o nome?',
] as const;

const EMPTY_PROMPT = [
  'Não entendi o que você quer. Consegue repetir?',
  'Ficou meio vago pra mim. Pode falar de novo?',
] as const;

const AGENT_OPEN_FAIL = [
  'Não consegui abrir o agent agora. Tenta de novo?',
  'Deu ruim pra abrir o agent. Pode tentar outra vez?',
] as const;

const AGENT_NO_REPLY = [
  'O agent não me respondeu. Quer que eu tente de novo?',
  'Não veio resposta do agent. Pode repetir o pedido?',
] as const;

const AGENT_EMPTY = [
  'Não consegui uma resposta clara. Pode perguntar de outro jeito?',
  'Fiquei sem uma resposta boa. Quer tentar de novo?',
] as const;

const GENERIC_FAIL = [
  'Não deu certo dessa vez. Consegue repetir?',
  'Algo deu errado aqui. Pode tentar outra vez?',
] as const;

const AUDIO_FAIL = [
  'Não entendi o áudio. Consegue repetir?',
  'Não consegui te ouvir bem. Pode falar de novo?',
] as const;

const SUMMARY_EMPTY = [
  'Não achei uma resposta clara pra te falar.',
  'Não consegui resumir isso de um jeito simples.',
] as const;

function pick(options: readonly string[]): string {
  const index = Math.floor(Math.random() * options.length);
  return options[index] ?? options[0]!;
}

export const jarvisVoice = {
  askRepeat: () => pick(ASK_REPEAT),
  listeningOk: () => pick(LISTENING_OK),
  ack: () => pick(ACK),
  projectNotFound: () => pick(PROJECT_NOT_FOUND),
  emptyPrompt: () => pick(EMPTY_PROMPT),
  agentOpenFail: () => pick(AGENT_OPEN_FAIL),
  agentNoReply: () => pick(AGENT_NO_REPLY),
  agentEmpty: () => pick(AGENT_EMPTY),
  genericFail: () => pick(GENERIC_FAIL),
  audioFail: () => pick(AUDIO_FAIL),
  summaryEmpty: () => pick(SUMMARY_EMPTY),
};
