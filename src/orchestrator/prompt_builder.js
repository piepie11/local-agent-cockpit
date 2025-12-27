function buildManagerPrompt({
  system,
  planText,
  conventionText,
  conventionPath,
  conventionSource,
  repoDigest,
  lastManagerPacket,
  lastExecLog,
  injected,
  turnIdx,
}) {
  const injectBlock = injected?.length ? injected.join('\n\n') : 'None';

  return `${system}

TURN_IDX: ${turnIdx ?? '?'}

CONTEXT:
<PLAN>
${planText}
</PLAN>

CONVENTION_SOURCE: ${conventionSource || 'none'}
CONVENTION_PATH: ${conventionPath || '(none)'}
<CONVENTION>
${conventionText || '(no convention provided)'}
</CONVENTION>

<REPO_DIGEST>
${repoDigest || '(repoDigest disabled)'}
</REPO_DIGEST>

LAST_MANAGER_PACKET:
${lastManagerPacket || 'None'}

LAST_EXEC_LOG:
${lastExecLog || 'None'}

HUMAN_INJECT:
${injectBlock}

TASK:
- Decide the next minimal step for the Executor, based on the PLAN and diagnostics.
- Enforce a strict git micro-loop: if the Executor changes anything, they must run a quick verification command and ensure the workspace is clean (commit if needed) before returning <EXEC_LOG>.
- If everything is complete, output exactly: Done
- Otherwise output exactly ONE <MANAGER_PACKET> and NOTHING ELSE.
- Do NOT wrap anything in markdown code fences.
`;
}

function buildManagerPromptResumeDelta({ system, repoDigestDelta, lastManagerPacket, lastExecLog, injected, turnIdx }) {
  const injectBlock = injected?.length ? injected.join('\n\n') : 'None';

  return `${system}

TURN_IDX: ${turnIdx ?? '?'}

MODE: stateful_resume (delta)

CONTEXT:
- The full PLAN and CONVENTION have already been provided earlier in this session.
- Only provide the next minimal step; do not restate the plan.

<REPO_DIGEST_DELTA>
${repoDigestDelta || '(no repoDigest delta)'}
</REPO_DIGEST_DELTA>

LAST_MANAGER_PACKET:
${lastManagerPacket || 'None'}

LAST_EXEC_LOG:
${lastExecLog || 'None'}

HUMAN_INJECT:
${injectBlock}

TASK:
- Decide the next minimal step for the Executor.
- Enforce a strict git micro-loop: if the Executor changes anything, they must run a quick verification command and ensure the workspace is clean (commit if needed) before returning <EXEC_LOG>.
- If everything is complete, output exactly: Done
- Otherwise output exactly ONE <MANAGER_PACKET> and NOTHING ELSE.
- Do NOT wrap anything in markdown code fences.
`;
}

function buildExecutorPrompt({ system, managerPacket, injected, turnIdx }) {
  const injectBlock = injected?.length ? injected.join('\n\n') : 'None';

  return `${system}

TURN_IDX: ${turnIdx ?? '?'}

MANAGER_PACKET:
${managerPacket}

HUMAN_INJECT:
${injectBlock}

TASK:
- Follow the Manager instructions exactly.
- If you change anything: run at least one quick verification command, and make sure the git workspace is clean before you finish (commit if needed).
- Output ONLY one <EXEC_LOG> block and NOTHING ELSE.
- Do NOT wrap anything in markdown code fences.
`;
}

function buildExecutorPromptResumeSeed({
  system,
  planText,
  conventionText,
  conventionPath,
  conventionSource,
  repoDigest,
  managerPacket,
  injected,
  turnIdx,
}) {
  const injectBlock = injected?.length ? injected.join('\n\n') : 'None';

  return `${system}

TURN_IDX: ${turnIdx ?? '?'}

MODE: stateful_resume (seed)

CONTEXT:
<PLAN>
${planText}
</PLAN>

CONVENTION_SOURCE: ${conventionSource || 'none'}
CONVENTION_PATH: ${conventionPath || '(none)'}
<CONVENTION>
${conventionText || '(no convention provided)'}
</CONVENTION>

<REPO_DIGEST>
${repoDigest || '(repoDigest disabled)'}
</REPO_DIGEST>

MANAGER_PACKET:
${managerPacket}

HUMAN_INJECT:
${injectBlock}

TASK:
- Follow the Manager instructions exactly.
- If you change anything: run at least one quick verification command, and make sure the git workspace is clean before you finish (commit if needed).
- Output ONLY one <EXEC_LOG> block and NOTHING ELSE.
- Do NOT wrap anything in markdown code fences.
`;
}

module.exports = {
  buildManagerPrompt,
  buildManagerPromptResumeDelta,
  buildExecutorPrompt,
  buildExecutorPromptResumeSeed,
};
