/**
 * Foreshadow Editor Extension for Twine 2
 *
 * Provides CodeMirror 5 syntax highlighting and linting for the
 * Foreshadow scripting language embedded in Twine passage text.
 *
 * Usage: add  "editorExtensions": "./foreshadow-editor.js"
 * to the window.storyFormat({...}) call in format.js.
 *
 * Scripting language syntax:
 *   ((function_name|param1|param2|...))
 *   Blocks may be nested. Case-insensitive.
 *
 * Functions:
 *   ((set|variable|value))
 *   ((get|variable))
 *   ((pc|attribute))
 *   ((npc|npc_id|attribute))
 *   ((if|condition|true_text))
 *   ((if|condition|true_text|false_text))
 *   ((if|pc|condition||||true_text))          -- pc ability variant
 *   ((if|pc|condition||||true_text|false_text))
 *   ((signal|signal_name))
 *   ((debug_log))
 *
 * Valid if operators: == != > < >= <=
 * PC/NPC attributes: name gender pro pro_cap pro_obj pronoun_obj_cap pro_pos pro_pos_cap
 */
(function () {
  "use strict";

  function setup() {
  // ─── Constants ────────────────────────────────────────────────────────────

  const VALID_FUNCTIONS = [
    "set",
    "get",
    "pc",
    "npc",
    "if",
    "signal",
    "debug_log",
  ];
  const IF_OPERATORS = ["==", "!=", ">=", "<=", ">", "<"];
  const PC_NPC_ATTRS = [
    "name",
    "gender",
    "pro",
    "pro_cap",
    "pro_obj",
    "pronoun_obj_cap",
    "pro_pos",
    "pro_pos_cap",
  ];

  // [min_args, max_args] after the function name.
  // null max = validated separately (if/pc variant).
  const PARAM_COUNTS = {
    set: [2, 2],
    get: [1, 1],
    pc: [1, 1],
    npc: [2, 2],
    if: [2, null],
    signal: [1, 1],
    debug_log: [0, 0],
  };

  // ─── CodeMirror Mode ──────────────────────────────────────────────────────

  CodeMirror.defineMode("foreshadow", function () {
    return {
      startState: function () {
        return {
          depth: 0, // nesting level
          pipeCount: 0, // pipes seen in the innermost block
          fnName: null, // function name of the innermost block
          fnStack: [], // saved state for outer blocks: [{ pipeCount, fnName }]
        };
      },

      copyState: function (state) {
        return {
          depth: state.depth,
          pipeCount: state.pipeCount,
          fnName: state.fnName,
          fnStack: state.fnStack.slice(),
        };
      },

      token: function (stream, state) {
        // ── Opening (( ──────────────────────────────────────────────────────
        if (stream.match("((")) {
          state.fnStack.push({
            pipeCount: state.pipeCount,
            fnName: state.fnName,
          });
          state.depth++;
          state.pipeCount = 0;
          state.fnName = null;
          return "foreshadow-bracket";
        }

        // ── Closing )) ──────────────────────────────────────────────────────
        if (state.depth > 0 && stream.match("))")) {
          const parent = state.fnStack.pop();
          state.depth--;
          state.pipeCount = parent ? parent.pipeCount : 0;
          state.fnName = parent ? parent.fnName : null;
          return "foreshadow-bracket";
        }

        // ── Inside a script block ───────────────────────────────────────────
        if (state.depth > 0) {
          // Don't consume (( or )) here — let the checks above handle them
          // on the next token call.
          if (stream.match("((", false) || stream.match("))", false)) {
            return null;
          }

          // Pipe separator
          if (stream.eat("|")) {
            state.pipeCount++;
            return "foreshadow-pipe";
          }

          // Function name — first thing after ((, before any pipe
          if (state.pipeCount === 0 && state.fnName === null) {
            if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
              const word = stream.current().toLowerCase();
              state.fnName = word;
              return VALID_FUNCTIONS.includes(word)
                ? "foreshadow-fn"
                : "foreshadow-error";
            }
          }

          // Comparison operators (before generic identifier match)
          if (stream.match(/^(==|!=|>=|<=|>|<)/)) {
            return "foreshadow-operator";
          }

          // Numbers
          if (stream.match(/^-?\d+(\.\d+)?/)) {
            return "foreshadow-number";
          }

          // Everything else up to the next |, (, ), or newline
          if (stream.match(/^[^|()\n]+/)) {
            // If this is the pc/npc attribute slot or get/signal param,
            // we can validate membership — but a simple color is enough here;
            // the linter handles semantic errors.
            return "foreshadow-param";
          }

          stream.next();
          return null;
        }

        // ── Regular passage prose ───────────────────────────────────────────
        stream.next();
        return null;
      },
    };
  });

  // ─── Linter ───────────────────────────────────────────────────────────────

  /**
   * Convert a character offset into a CodeMirror {line, ch} position.
   */
  function offsetToPos(text, offset) {
    const before = text.substring(0, offset).split("\n");
    return CodeMirror.Pos(before.length - 1, before[before.length - 1].length);
  }

  /**
   * Validate one parsed block and push any issues into errors[].
   *
   * @param {number}   start   - char offset of opening ((
   * @param {number}   end     - char offset just past closing ))
   * @param {string[]} tokens  - [fnName, arg0, arg1, ...]  (already trimmed)
   * @param {object[]} errors  - accumulator
   */
  function validateBlock(start, end, tokens, errors) {
    const fnName = tokens[0].toLowerCase();
    const args = tokens.slice(1);
    const argCount = args.length;

    if (!VALID_FUNCTIONS.includes(fnName)) {
      errors.push({
        from: start,
        to: start + 2 + tokens[0].length,
        message: `Unknown function: '${fnName}'`,
        severity: "error",
      });
      return;
    }

    const [min, max] = PARAM_COUNTS[fnName];

    // ── if: two variants ────────────────────────────────────────────────────
    if (fnName === "if") {
      if (argCount < 2) {
        errors.push({
          from: start,
          to: end,
          message: `'if' needs at least 2 arguments (condition, true_text), got ${argCount}`,
          severity: "error",
        });
        return;
      }

      const isPcVariant = args[0].trim().toLowerCase() === "pc";

      if (isPcVariant) {
        // ((if|pc|condition||||true_text|false_text?))
        // params[0]="pc" params[1]=condition params[2..3]=unused
        // params[4]=true_text params[5]=false_text
        if (argCount < 5) {
          errors.push({
            from: start,
            to: end,
            message: `'if|pc' needs at least 5 arguments, got ${argCount}`,
            severity: "error",
          });
          return;
        }
        if (argCount > 6) {
          errors.push({
            from: start,
            to: end,
            message: `'if|pc' takes at most 6 arguments, got ${argCount}`,
            severity: "warning",
          });
        }
        validateIfCondition(start, end, args[1], errors);
      } else {
        // ((if|condition|true_text|false_text?))
        if (argCount > 3) {
          errors.push({
            from: start,
            to: end,
            message: `'if' takes at most 3 arguments, got ${argCount}`,
            severity: "warning",
          });
        }
        validateIfCondition(start, end, args[0], errors);
      }
      return;
    }

    // ── All other functions ─────────────────────────────────────────────────
    if (argCount < min) {
      errors.push({
        from: start,
        to: end,
        message: `'${fnName}' needs ${min} argument(s), got ${argCount}`,
        severity: "error",
      });
    } else if (max !== null && argCount > max) {
      errors.push({
        from: start,
        to: end,
        message: `'${fnName}' takes at most ${max} argument(s), got ${argCount}`,
        severity: "warning",
      });
    }

    // ── pc / npc attribute validation ────────────────────────────────────────
    if (fnName === "pc" && argCount >= 1) {
      const attr = args[0].trim().toLowerCase();
      if (!PC_NPC_ATTRS.includes(attr)) {
        errors.push({
          from: start,
          to: end,
          message: `Unknown pc attribute: '${attr}'. Valid: ${PC_NPC_ATTRS.join(", ")}`,
          severity: "warning",
        });
      }
    }

    if (fnName === "npc" && argCount >= 2) {
      const attr = args[1].trim().toLowerCase();
      if (!PC_NPC_ATTRS.includes(attr)) {
        errors.push({
          from: start,
          to: end,
          message: `Unknown npc attribute: '${attr}'. Valid: ${PC_NPC_ATTRS.join(", ")}`,
          severity: "warning",
        });
      }
    }
  }

  /**
   * Validate the space-delimited "variable operator value" condition string.
   */
  function validateIfCondition(start, end, condition, errors) {
    const parts = condition.trim().split(/\s+/);
    if (parts.length !== 3) {
      errors.push({
        from: start,
        to: end,
        message: `'if' condition should be 'variable operator value', got: '${condition.trim()}'`,
        severity: "warning",
      });
      return;
    }
    const op = parts[1];
    if (!IF_OPERATORS.includes(op)) {
      errors.push({
        from: start,
        to: end,
        message: `Unknown operator '${op}' in if condition. Valid: ${IF_OPERATORS.join(" ")}`,
        severity: "error",
      });
    }
  }

  /**
   * Parse the full passage text and return a list of error objects
   * with char offsets (not yet converted to CM positions).
   */
  function parseForeshadow(text) {
    const errors = [];
    const stack = []; // { start, tokens: string[], currentToken: string }
    const len = text.length;
    let i = 0;

    while (i < len) {
      // ── Opening (( ────────────────────────────────────────────────────────
      if (text.substr(i, 2) === "((") {
        stack.push({ start: i, tokens: [], currentToken: "" });
        i += 2;
        continue;
      }

      if (stack.length === 0) {
        i++;
        continue;
      }

      const block = stack[stack.length - 1];

      // ── Closing )) ────────────────────────────────────────────────────────
      if (text.substr(i, 2) === "))") {
        // Finalize the last token
        block.tokens.push(block.currentToken);
        const tokens = block.tokens.map(function (t) {
          return t.trim();
        });
        stack.pop();

        if (tokens[0] === "") {
          errors.push({
            from: block.start,
            to: i + 2,
            message: "Empty script block (( ))",
            severity: "warning",
          });
        } else {
          validateBlock(block.start, i + 2, tokens, errors);
        }

        // If we popped into a parent block, append a placeholder so the
        // parent's token text doesn't run together across the nested span.
        if (stack.length > 0) {
          stack[stack.length - 1].currentToken += "((\u2026))";
        }

        i += 2;
        continue;
      }

      // ── Pipe separator ────────────────────────────────────────────────────
      if (text[i] === "|") {
        block.tokens.push(block.currentToken);
        block.currentToken = "";
        i++;
        continue;
      }

      // ── Regular character inside block ────────────────────────────────────
      block.currentToken += text[i];
      i++;
    }

    // Any blocks still on the stack were never closed.
    for (const unclosed of stack) {
      errors.push({
        from: unclosed.start,
        to: unclosed.start + 2,
        message: "Unclosed '((' — missing '))'",
        severity: "error",
      });
    }

    return errors;
  }

  /**
   * CodeMirror lint helper — called by the lint addon with the full text.
   */
  function lintForeshadow(text) {
    return parseForeshadow(text).map(function (e) {
      return {
        message: e.message,
        severity: e.severity,
        from: offsetToPos(text, e.from),
        to: offsetToPos(text, e.to),
      };
    });
  }

  if (CodeMirror.registerHelper) {
    CodeMirror.registerHelper("lint", "foreshadow", lintForeshadow);
  }

  // ─── Token styles ─────────────────────────────────────────────────────────

  const css = `
    /* Foreshadow scripting language — token colours */
    .cm-foreshadow-bracket  { color: #e8a900; font-weight: bold; }
    .cm-foreshadow-fn       { color: #7ecfff; font-weight: bold; }
    .cm-foreshadow-pipe     { color: #6272a4; }
    .cm-foreshadow-operator { color: #ff79c6; }
    .cm-foreshadow-number   { color: #bd93f9; }
    .cm-foreshadow-param    { color: #50fa7b; }
    .cm-foreshadow-error    { color: #ff5555; text-decoration: underline wavy red; }
  `;

  const styleEl = document.createElement("style");
  styleEl.id = "foreshadow-editor-styles";
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ─── Apply to Twine's editor ───────────────────────────────────────────────
  //
  // Twine 2.4+ loads editorExtensions as a module and the exact integration
  // surface differs by Twine version.  The block below covers three approaches:
  //
  //   1. twineEditorExtensions object  (some 2.4.x builds)
  //   2. Monkey-patching CodeMirror instances that already exist in the DOM
  //   3. Observing new CodeMirror instances added later (MutationObserver)
  //

  function applyModeToEditor(cm) {
    cm.setOption("mode", "foreshadow");
    if (cm.setOption && CodeMirror.registerHelper) {
      cm.setOption("lint", { getAnnotations: lintForeshadow, async: false });
    }
  }

  // Approach 1 — Twine's declared extension hook (if present)
  if (window.twineEditorExtensions) {
    window.twineEditorExtensions.push({
      mode: "foreshadow",
      lint: lintForeshadow,
    });
  }

  // Approach 2 & 3 — directly patch any CodeMirror instances
  function patchExisting() {
    document.querySelectorAll(".CodeMirror").forEach(function (el) {
      if (el.CodeMirror && el.CodeMirror.getOption("mode") !== "foreshadow") {
        applyModeToEditor(el.CodeMirror);
      }
    });
  }

  // Defer first patch so Twine's React component finishes mounting the editor
  setTimeout(patchExisting, 0);

  // Watch for passage editor dialogs opening after page load
  const observer = new MutationObserver(function () {
    setTimeout(patchExisting, 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  } // end setup()

  // Twine may bundle CodeMirror as a module rather than exposing it on window
  // immediately. Retry until it is available.
  (function trySetup() {
    if (typeof window.CodeMirror !== "undefined") {
      setup();
    } else {
      setTimeout(trySetup, 50);
    }
  })();
})();
