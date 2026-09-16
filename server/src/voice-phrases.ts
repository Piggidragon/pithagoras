/**
 * Short spoken fillers, rendered ahead of time and played while the agent
 * works. The tool kinds match the browser's grouping of tool calls.
 */
export type FillerKind = "murmur" | "think" | "still" | "command" | "browser" | "search" | "read" | "edit";

export interface VoicePhrases {
  murmur?: string[];
  think: string[];
  still: string[];
  command: string[];
  browser: string[];
  search: string[];
  read: string[];
  edit: string[];
  compacting: string[];
  compactionWait: string;
  compactionDone: string;
  compactionStopped: string;
}

/** Wordless murmurs; languages whose hesitation sounds differ override them. */
export const MURMURS = ["Hmm.", "Hmm...", "Mhm.", "Uhm..."];

/**
 * Keyed by the voice input language. A language missing here gets wordless
 * murmurs only, with status notices in English, rather than guessed wording.
 */
export const PHRASES: Record<string, VoicePhrases> = {
  en: {
    think: ["Let me think about that for a moment.", "Give me a moment to think this through.", "Let me consider that.", "I’m thinking through your request.", "Let me take a moment with that."],
    still: ["Still on it.", "One moment.", "Bear with me."],
    command: ["Let me run that.", "Running something quickly."],
    browser: ["Let me check the browser.", "I’ll look at that in the browser."],
    search: ["Let me search for that.", "Let me look around."],
    read: ["Let me read that.", "Taking a look."],
    edit: ["Making the change.", "Let me update that."],
    compacting: ["My context is getting full. Let me quickly compact our conversation before I continue.", "I need a little room in my context. Let me summarize our conversation, then I'll carry on.", "Let me do a quick context compaction so I can keep going."],
    compactionWait: "I'm still compacting our conversation. Please wait a moment; I'll let you know when I'm ready.",
    compactionDone: "Context compaction is done. I'm ready to continue.",
    compactionStopped: "Context compaction stopped before it finished.",
  },
  de: {
    think: ["Moment, ich denke kurz nach.", "Lass mich das kurz durchdenken.", "Gute Frage, einen Moment."],
    still: ["Bin noch dran.", "Einen Moment noch.", "Gleich."],
    command: ["Ich führe das kurz aus.", "Ich starte das mal."],
    browser: ["Ich schau kurz im Browser nach.", "Ich check das mal im Browser."],
    search: ["Ich such mal kurz.", "Mal sehen, was ich finde."],
    read: ["Ich les mal kurz rein.", "Ich schau mir das mal an."],
    edit: ["Ich pass das kurz an.", "Ich änder das mal."],
    compacting: ["Mein Kontext wird voll. Ich fasse unser Gespräch kurz zusammen und mache dann weiter.", "Ich brauche etwas Platz im Kontext. Einen Moment, ich fasse kurz zusammen."],
    compactionWait: "Ich fasse unser Gespräch noch zusammen. Einen Moment bitte, ich sage Bescheid, wenn ich so weit bin.",
    compactionDone: "Die Zusammenfassung ist fertig. Ich kann weitermachen.",
    compactionStopped: "Die Zusammenfassung wurde abgebrochen, bevor sie fertig war.",
  },
  es: {
    murmur: ["Mmm.", "Mmm...", "Eh...", "A ver..."],
    think: ["Déjame pensarlo un momento.", "Un momento, lo estoy pensando.", "Déjame considerarlo."],
    still: ["Sigo en ello.", "Un momento.", "Ya casi."],
    command: ["Voy a ejecutarlo.", "Ejecuto algo rápido."],
    browser: ["Lo miro en el navegador.", "Déjame revisar el navegador."],
    search: ["Voy a buscarlo.", "A ver qué encuentro."],
    read: ["Déjame leerlo.", "Le echo un vistazo."],
    edit: ["Hago el cambio.", "Déjame actualizarlo."],
    compacting: ["Mi contexto se está llenando. Voy a resumir nuestra conversación y sigo.", "Necesito un poco de espacio en el contexto. Un momento, resumo rápido."],
    compactionWait: "Todavía estoy resumiendo la conversación. Espera un momento; te aviso cuando esté listo.",
    compactionDone: "El resumen está listo. Puedo continuar.",
    compactionStopped: "El resumen se detuvo antes de terminar.",
  },
  fr: {
    murmur: ["Hmm.", "Hmm...", "Euh...", "Bon..."],
    think: ["Laisse-moi réfléchir un instant.", "Un instant, je réfléchis.", "Voyons voir."],
    still: ["J’y suis encore.", "Un instant.", "Presque."],
    command: ["Je lance ça.", "J’exécute quelque chose rapidement."],
    browser: ["Je regarde dans le navigateur.", "Je vérifie ça dans le navigateur."],
    search: ["Je cherche.", "Voyons ce que je trouve."],
    read: ["Je lis ça.", "J’y jette un œil."],
    edit: ["Je fais la modification.", "Je mets ça à jour."],
    compacting: ["Mon contexte se remplit. Je résume notre conversation, puis je continue.", "J’ai besoin d’un peu de place dans mon contexte. Un instant, je résume."],
    compactionWait: "Je suis encore en train de résumer notre conversation. Un instant, je te préviens dès que c’est prêt.",
    compactionDone: "Le résumé est terminé. Je peux continuer.",
    compactionStopped: "Le résumé s’est arrêté avant la fin.",
  },
  it: {
    murmur: ["Mmm.", "Mmm...", "Ehm...", "Allora..."],
    think: ["Fammi pensare un attimo.", "Un momento, ci sto pensando.", "Vediamo."],
    still: ["Ci sto ancora lavorando.", "Un attimo.", "Quasi."],
    command: ["Lo eseguo.", "Eseguo una cosa al volo."],
    browser: ["Controllo nel browser.", "Guardo nel browser."],
    search: ["Faccio una ricerca.", "Vediamo cosa trovo."],
    read: ["Lo leggo.", "Do un’occhiata."],
    edit: ["Faccio la modifica.", "Lo aggiorno."],
    compacting: ["Il mio contesto si sta riempiendo. Riassumo la conversazione e poi continuo.", "Mi serve un po’ di spazio nel contesto. Un attimo, faccio un riassunto."],
    compactionWait: "Sto ancora riassumendo la conversazione. Aspetta un momento, ti avviso quando ho finito.",
    compactionDone: "Il riassunto è pronto. Posso continuare.",
    compactionStopped: "Il riassunto si è interrotto prima di finire.",
  },
  pt: {
    murmur: ["Hmm.", "Hmm...", "Éh...", "Deixa eu ver..."],
    think: ["Deixa eu pensar um momento.", "Um momento, estou pensando.", "Deixa eu ver."],
    still: ["Ainda estou nisso.", "Um momento.", "Quase lá."],
    command: ["Vou executar isso.", "Vou rodar uma coisa rapidinho."],
    browser: ["Vou ver no navegador.", "Deixa eu conferir no navegador."],
    search: ["Vou pesquisar.", "Vamos ver o que eu encontro."],
    read: ["Deixa eu ler isso.", "Vou dar uma olhada."],
    edit: ["Vou fazer a alteração.", "Deixa eu atualizar isso."],
    compacting: ["Meu contexto está ficando cheio. Vou resumir a conversa e depois continuo.", "Preciso de espaço no contexto. Um momento, vou resumir."],
    compactionWait: "Ainda estou resumindo a conversa. Espera um momento; aviso quando estiver tudo pronto.",
    compactionDone: "O resumo está pronto. Posso continuar.",
    compactionStopped: "O resumo parou antes de terminar.",
  },
  ru: {
    murmur: ["Хм.", "Хм...", "Мм.", "Э-э..."],
    think: ["Дай мне немного подумать.", "Секунду, я подумаю.", "Сейчас посмотрим."],
    still: ["Ещё работаю.", "Секунду.", "Почти."],
    command: ["Сейчас запущу.", "Быстро кое-что выполню."],
    browser: ["Посмотрю в браузере.", "Сейчас проверю в браузере."],
    search: ["Сейчас поищу.", "Посмотрим, что найдётся."],
    read: ["Сейчас прочитаю.", "Взгляну."],
    edit: ["Вношу изменение.", "Сейчас обновлю."],
    compacting: ["Мой контекст заполняется. Кратко подытожу разговор и продолжу.", "Мне нужно место в контексте. Секунду, подытожу."],
    compactionWait: "Я ещё подытоживаю разговор. Подожди немного, я скажу, когда всё будет готово.",
    compactionDone: "Сжатие контекста завершено. Могу продолжать.",
    compactionStopped: "Сжатие контекста остановилось, не завершившись.",
  },
  zh: {
    murmur: ["嗯。", "嗯……", "呃……", "我看看……"],
    think: ["让我想一想。", "稍等，我考虑一下。", "我想想看。"],
    still: ["还在处理。", "稍等一下。", "快好了。"],
    command: ["我来运行一下。", "我执行一下。"],
    browser: ["我在浏览器里看一下。", "我去浏览器查一下。"],
    search: ["我搜一下。", "看看能找到什么。"],
    read: ["我读一下。", "我看一眼。"],
    edit: ["我来改一下。", "我更新一下。"],
    compacting: ["我的上下文快满了。我先简单总结一下我们的对话，然后继续。", "我需要一些上下文空间。稍等，我总结一下。"],
    compactionWait: "我还在总结我们的对话。请稍等，准备好了我会告诉你。",
    compactionDone: "上下文压缩完成了，我可以继续了。",
    compactionStopped: "上下文压缩在完成前停止了。",
  },
  ja: {
    murmur: ["うーん。", "うーん…", "えーと…", "そうですね…"],
    think: ["少し考えさせてください。", "ちょっと考えますね。", "えーと、考えてみます。"],
    still: ["まだ作業中です。", "少々お待ちください。", "もう少しです。"],
    command: ["実行してみます。", "ちょっと実行しますね。"],
    browser: ["ブラウザで確認します。", "ブラウザで見てみますね。"],
    search: ["検索してみます。", "探してみますね。"],
    read: ["読んでみます。", "ちょっと見てみます。"],
    edit: ["変更しますね。", "更新します。"],
    compacting: ["コンテキストがいっぱいになってきました。会話を要約してから続けます。", "コンテキストに少し余裕が必要です。少々お待ちください、要約します。"],
    compactionWait: "まだ会話を要約しています。少々お待ちください。終わったらお知らせします。",
    compactionDone: "要約が終わりました。続けられます。",
    compactionStopped: "要約は完了する前に止まりました。",
  },
  ko: {
    murmur: ["음.", "음...", "어...", "그러니까..."],
    think: ["잠깐 생각해 볼게요.", "잠시만요, 생각 중이에요.", "어디 보자."],
    still: ["아직 작업 중이에요.", "잠시만요.", "거의 다 됐어요."],
    command: ["실행해 볼게요.", "잠깐 실행할게요."],
    browser: ["브라우저에서 확인해 볼게요.", "브라우저로 볼게요."],
    search: ["검색해 볼게요.", "뭐가 있는지 볼게요."],
    read: ["읽어 볼게요.", "한번 볼게요."],
    edit: ["수정할게요.", "업데이트할게요."],
    compacting: ["컨텍스트가 차고 있어요. 대화를 간단히 요약하고 계속할게요.", "컨텍스트 공간이 좀 필요해요. 잠시만요, 요약할게요."],
    compactionWait: "아직 대화를 요약하고 있어요. 잠시만 기다려 주세요. 준비되면 알려 드릴게요.",
    compactionDone: "요약이 끝났어요. 계속할 수 있어요.",
    compactionStopped: "요약이 끝나기 전에 중단됐어요.",
  },
  hi: {
    think: ["एक पल, सोचने दीजिए।", "इस पर थोड़ा सोचने दीजिए।", "देखते हैं।"],
    still: ["काम जारी है।", "बस एक पल।", "लगभग हो गया।"],
    command: ["इसे चलाते हैं।", "एक चीज़ जल्दी से चलाते हैं।"],
    browser: ["ब्राउज़र में देखते हैं।", "ब्राउज़र में जाँच करते हैं।"],
    search: ["खोजते हैं।", "देखते हैं क्या मिलता है।"],
    read: ["इसे पढ़ते हैं।", "एक नज़र डालते हैं।"],
    edit: ["बदलाव करते हैं।", "इसे अपडेट करते हैं।"],
    compacting: ["कॉन्टेक्स्ट भर रहा है। बातचीत का सारांश बनाकर आगे बढ़ते हैं।", "कॉन्टेक्स्ट में थोड़ी जगह चाहिए। एक पल, सारांश बन रहा है।"],
    compactionWait: "बातचीत का सारांश अभी बन रहा है। कृपया थोड़ा रुकिए, तैयार होते ही बताया जाएगा।",
    compactionDone: "सारांश पूरा हो गया। अब आगे बढ़ सकते हैं।",
    compactionStopped: "सारांश पूरा होने से पहले रुक गया।",
  },
  ar: {
    think: ["دعني أفكر في ذلك لحظة.", "لحظة، أفكر في الأمر.", "لنرَ."],
    still: ["ما زلت أعمل على ذلك.", "لحظة واحدة.", "تقريبًا انتهيت."],
    command: ["سأشغّل ذلك.", "أنفّذ شيئًا بسرعة."],
    browser: ["سأتحقق في المتصفح.", "دعني أنظر في المتصفح."],
    search: ["سأبحث عن ذلك.", "لنرَ ماذا أجد."],
    read: ["دعني أقرأ ذلك.", "سألقي نظرة."],
    edit: ["سأجري التعديل.", "دعني أحدّث ذلك."],
    compacting: ["سياقي يمتلئ. سألخّص محادثتنا بسرعة ثم أتابع.", "أحتاج إلى بعض المساحة في السياق. لحظة، سألخّص."],
    compactionWait: "ما زلت ألخّص محادثتنا. انتظر لحظة من فضلك، وسأخبرك عندما يصبح كل شيء جاهزًا.",
    compactionDone: "انتهى التلخيص. يمكنني المتابعة.",
    compactionStopped: "توقف التلخيص قبل أن يكتمل.",
  },
};

/** The configured input language, or the first requested one with phrases when voice auto-detects. */
export function phraseLanguage(configured: string | undefined, requested: readonly string[] = []) {
  if (configured && configured !== "auto") return configured;
  return requested.map(tag => tag.toLowerCase().split("-")[0]).find(code => code in PHRASES) ?? "en";
}

/** Status notices fall back to English; fillers do not, so they never speak the wrong language. */
export const statusPhrases = (language: string) => PHRASES[language] ?? PHRASES.en;

/** One phrase of every kind first, then the variations, so the most useful clips are ready soonest. */
export function fillerPhrases(language: string): { kind: FillerKind; text: string }[] {
  const table = PHRASES[language];
  const groups: [FillerKind, string[]][] = [["murmur", table?.murmur ?? MURMURS]];
  if (table) groups.push(["think", table.think.slice(0, 3)], ["command", table.command], ["read", table.read], ["edit", table.edit], ["browser", table.browser], ["search", table.search], ["still", table.still]);
  const rounds = Math.max(...groups.map(([, texts]) => texts.length));
  return Array.from({ length: rounds }, (_, i) => groups.filter(([, texts]) => i < texts.length).map(([kind, texts]) => ({ kind, text: texts[i] }))).flat();
}
