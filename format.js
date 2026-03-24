var VERSION = "0.0.12";

// ─── Foreshadow editor extension ──────────────────────────────────────────────
// Runs inline when Twine loads this format file
try { (function () {
  "use strict";

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
  const PARAM_COUNTS = {
    set: [2, 2],
    get: [1, 1],
    pc: [1, 1],
    npc: [2, 2],
    if: [2, null],
    signal: [1, 1],
    debug_log: [0, 0],
  };

  var modeRegistered = false;
  var STAMP = "_foreshadow_" + VERSION;

  function ensureModeRegistered(CM) {
    if (modeRegistered) return;
    modeRegistered = true;

    CM.defineMode("foreshadow", function () {
      return {
        startState: function () {
          return {
            depth: 0,
            pipeCount: 0,
            fnName: null,
            fnStack: [],
            inLink: false,
          };
        },
        copyState: function (state) {
          return {
            depth: state.depth,
            pipeCount: state.pipeCount,
            fnName: state.fnName,
            fnStack: state.fnStack.slice(),
            inLink: state.inLink,
          };
        },
        token: function (stream, state) {
          // ── Script block opening (( ───────────────────────────────────────
          if (stream.match("((")) {
            state.fnStack.push({
              pipeCount: state.pipeCount,
              fnName: state.fnName,
            });
            const cls = "foreshadow-bracket-" + ((state.depth % 3) + 1);
            state.depth++;
            state.pipeCount = 0;
            state.fnName = null;
            return cls;
          }
          // ── Script block closing )) ───────────────────────────────────────
          if (state.depth > 0 && stream.match("))")) {
            const parent = state.fnStack.pop();
            const cls = "foreshadow-bracket-" + (((state.depth - 1) % 3) + 1);
            state.depth--;
            state.pipeCount = parent ? parent.pipeCount : 0;
            state.fnName = parent ? parent.fnName : null;
            return cls;
          }
          // ── Inside a script block ─────────────────────────────────────────
          if (state.depth > 0) {
            if (stream.match("((", false) || stream.match("))", false))
              return null;
            if (stream.eat("|")) {
              state.pipeCount++;
              return "foreshadow-pipe";
            }
            if (state.pipeCount === 0 && state.fnName === null) {
              if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
                const word = stream.current().toLowerCase();
                state.fnName = word;
                return VALID_FUNCTIONS.includes(word)
                  ? "foreshadow-fn"
                  : "foreshadow-error";
              }
            }
            if (stream.match(/^(==|!=|>=|<=|>|<)/))
              return "foreshadow-operator";
            if (stream.match(/^-?\d+(\.\d+)?/)) return "foreshadow-number";
            if (stream.match(/^[^|()\n]+/)) return "foreshadow-param";
            stream.next();
            return null;
          }
          // ── Twine link [[ ]] ──────────────────────────────────────────────
          if (!state.inLink && stream.match("[[")) {
            state.inLink = true;
            return "foreshadow-link-bracket";
          }
          if (state.inLink) {
            if (stream.match("]]")) {
              state.inLink = false;
              return "foreshadow-link-bracket";
            }
            if (stream.match("->") || stream.match("<-"))
              return "foreshadow-link-arrow";
            if (stream.eat("|")) return "foreshadow-link-arrow";
            if (stream.match(/^[^\]|<>-]+/)) return "foreshadow-link-text";
            stream.next();
            return "foreshadow-link-text";
          }
          // ── Regular prose ─────────────────────────────────────────────────
          stream.next();
          return null;
        },
      };
    });

    if (CM.registerHelper) {
      CM.registerHelper("lint", "foreshadow", lintForeshadow);
      CM.registerHelper("hint", "foreshadow", getForeshadowCompletions);
    }

    const existingStyle = document.getElementById("foreshadow-editor-styles");
    if (existingStyle) existingStyle.remove();
    const styleEl = document.createElement("style");
    styleEl.id = "foreshadow-editor-styles";
    styleEl.textContent = `
        .cm-foreshadow-bracket-1 { color: #e8a900; font-weight: bold; }
        .cm-foreshadow-bracket-2 { color: #c678dd; font-weight: bold; }
        .cm-foreshadow-bracket-3 { color: #56b6c2; font-weight: bold; }
        .cm-foreshadow-fn        { color: #7ecfff; font-weight: bold; }
        .cm-foreshadow-pipe      { color: #6272a4; }
        .cm-foreshadow-operator  { color: #ff79c6; }
        .cm-foreshadow-number    { color: #bd93f9; }
        .cm-foreshadow-param     { color: #50fa7b; }
        .cm-foreshadow-error     { color: #ff5555; text-decoration: underline wavy red; }
        .cm-foreshadow-link-bracket { color: #8be9fd; font-weight: bold; }
        .cm-foreshadow-link-text    { color: #f1fa8c; }
        .cm-foreshadow-link-arrow   { color: #6272a4; }
      `;
    document.head.appendChild(styleEl);
  }

  function offsetToPos(text, offset) {
    const before = text.substring(0, offset).split("\n");
    return { line: before.length - 1, ch: before[before.length - 1].length };
  }

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
    if (!IF_OPERATORS.includes(op))
      errors.push({
        from: start,
        to: end,
        message: `Unknown operator '${op}'. Valid: ${IF_OPERATORS.join(" ")}`,
        severity: "error",
      });
  }

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
    if (fnName === "if") {
      if (argCount < 2) {
        errors.push({
          from: start,
          to: end,
          message: `'if' needs at least 2 arguments, got ${argCount}`,
          severity: "error",
        });
        return;
      }
      const isPcVariant = args[0].trim().toLowerCase() === "pc";
      if (isPcVariant) {
        if (argCount < 5) {
          errors.push({
            from: start,
            to: end,
            message: `'if|pc' needs at least 5 arguments, got ${argCount}`,
            severity: "error",
          });
          return;
        }
        if (argCount > 6)
          errors.push({
            from: start,
            to: end,
            message: `'if|pc' takes at most 6 arguments, got ${argCount}`,
            severity: "warning",
          });
        validateIfCondition(start, end, args[1], errors);
      } else {
        if (argCount > 3)
          errors.push({
            from: start,
            to: end,
            message: `'if' takes at most 3 arguments, got ${argCount}`,
            severity: "warning",
          });
        validateIfCondition(start, end, args[0], errors);
      }
      return;
    }
    if (argCount < min)
      errors.push({
        from: start,
        to: end,
        message: `'${fnName}' needs ${min} argument(s), got ${argCount}`,
        severity: "error",
      });
    else if (max !== null && argCount > max)
      errors.push({
        from: start,
        to: end,
        message: `'${fnName}' takes at most ${max} argument(s), got ${argCount}`,
        severity: "warning",
      });
    if (fnName === "pc" && argCount >= 1) {
      const attr = args[0].trim().toLowerCase();
      if (!PC_NPC_ATTRS.includes(attr))
        errors.push({
          from: start,
          to: end,
          message: `Unknown pc attribute: '${attr}'. Valid: ${PC_NPC_ATTRS.join(", ")}`,
          severity: "warning",
        });
    }
    if (fnName === "npc" && argCount >= 2) {
      const attr = args[1].trim().toLowerCase();
      if (!PC_NPC_ATTRS.includes(attr))
        errors.push({
          from: start,
          to: end,
          message: `Unknown npc attribute: '${attr}'. Valid: ${PC_NPC_ATTRS.join(", ")}`,
          severity: "warning",
        });
    }
  }

  function parseForeshadow(text) {
    const errors = [],
      stack = [];
    let i = 0;
    while (i < text.length) {
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
      if (text.substr(i, 2) === "))") {
        block.tokens.push(block.currentToken);
        const tokens = block.tokens.map((t) => t.trim());
        stack.pop();
        if (tokens[0] === "")
          errors.push({
            from: block.start,
            to: i + 2,
            message: "Empty script block (( ))",
            severity: "warning",
          });
        else validateBlock(block.start, i + 2, tokens, errors);
        if (stack.length > 0)
          stack[stack.length - 1].currentToken += "((\u2026))";
        i += 2;
        continue;
      }
      if (text[i] === "|") {
        block.tokens.push(block.currentToken);
        block.currentToken = "";
        i++;
        continue;
      }
      block.currentToken += text[i];
      i++;
    }
    for (const unclosed of stack)
      errors.push({
        from: unclosed.start,
        to: unclosed.start + 2,
        message: "Unclosed '((' — missing '))'",
        severity: "error",
      });
    return errors;
  }

  function lintForeshadow(text) {
    return parseForeshadow(text).map((e) => ({
      message: e.message,
      severity: e.severity,
      from: offsetToPos(text, e.from),
      to: offsetToPos(text, e.to),
    }));
  }

  // ─── Hint / autocomplete ──────────────────────────────────────────────────
  // Computes completions for the token at the cursor when inside a (( )) block.

  function getForeshadowCompletions(cm) {
    const cursor = cm.getCursor();
    let cursorOffset = 0;
    for (let i = 0; i < cursor.line; i++)
      cursorOffset += cm.getLine(i).length + 1;
    cursorOffset += cursor.ch;

    const textBefore = cm.getValue().substring(0, cursorOffset);

    // Walk backwards to find the innermost unclosed (( block
    let depth = 0,
      blockStart = -1;
    let i = textBefore.length - 1;
    while (i >= 1) {
      if (textBefore[i - 1] === ")" && textBefore[i] === ")") {
        depth++;
        i -= 2;
        continue;
      }
      if (textBefore[i - 1] === "(" && textBefore[i] === "(") {
        if (depth === 0) {
          blockStart = i - 1;
          break;
        }
        depth--;
        i -= 2;
        continue;
      }
      i--;
    }
    if (blockStart === -1) return null;

    const parts = textBefore.substring(blockStart + 2).split("|");
    const partIndex = parts.length - 1;
    const currentPart = parts[partIndex];
    const trimmed = currentPart.trimStart();
    const partial = trimmed.toLowerCase();

    let list = [];
    if (partIndex === 0) {
      list = VALID_FUNCTIONS.filter((f) => f.startsWith(partial));
    } else {
      const fn = parts[0].trim().toLowerCase();
      const param = partIndex - 1;
      if (fn === "pc" && param === 0)
        list = PC_NPC_ATTRS.filter((a) => a.startsWith(partial));
      else if (fn === "npc" && param === 1)
        list = PC_NPC_ATTRS.filter((a) => a.startsWith(partial));
      else if (fn === "if" && param === 0 && "pc".startsWith(partial))
        list = ["pc"];
    }

    // Don't suggest when the word is already an exact match
    if (list.length === 1 && list[0] === partial) return null;
    if (!list.length) return null;

    return {
      list,
      from: { line: cursor.line, ch: cursor.ch - trimmed.length },
      to: cursor,
    };
  }

  // ─── Hint widget ─────────────────────────────

  var activeHint = null;

  function closeHintWidget() {
    if (!activeHint) return;
    activeHint.el.remove();
    document.removeEventListener("mousedown", activeHint.docHandler);
    activeHint.cm.removeKeyMap(activeHint.keyMap);
    activeHint = null;
  }

  function showHintWidget(cm) {
    closeHintWidget();
    const result = getForeshadowCompletions(cm);
    if (!result) return;
    const coords = cm.cursorCoords(true, "page");
    let activeIndex = 0;

    const ul = document.createElement("ul");
    ul.style.cssText = [
      "position:fixed",
      "left:" + Math.round(coords.left) + "px",
      "top:" + Math.round(coords.bottom + 2) + "px",
      "background:#282a36",
      "border:1px solid #44475a",
      "border-radius:4px",
      "list-style:none",
      "margin:0",
      "padding:2px 0",
      "z-index:99999",
      "font-family:monospace",
      "font-size:13px",
      "box-shadow:0 4px 12px rgba(0,0,0,0.5)",
      "min-width:130px",
    ].join(";");

    function render() {
      ul.innerHTML = "";
      result.list.forEach(function (item, idx) {
        const li = document.createElement("li");
        li.textContent = item;
        li.style.cssText =
          "padding:3px 10px;cursor:pointer;color:#f8f8f2;" +
          (idx === activeIndex ? "background:#44475a;" : "");
        li.addEventListener("mouseenter", function () {
          activeIndex = idx;
          render();
        });
        li.addEventListener("mousedown", function (e) {
          e.preventDefault();
          pick();
        });
        ul.appendChild(li);
      });
    }

    function pick() {
      if (!activeHint) return;
      activeHint.skipNext = true;
      cm.replaceRange(result.list[activeIndex], result.from, result.to);
      closeHintWidget();
    }

    function move(dir) {
      activeIndex =
        (activeIndex + dir + result.list.length) % result.list.length;
      render();
    }

    render();
    document.body.appendChild(ul);

    const keyMap = {
      Up: function () {
        move(-1);
      },
      Down: function () {
        move(1);
      },
      Enter: function () {
        pick();
      },
      Tab: function () {
        pick();
      },
      Esc: function () {
        closeHintWidget();
      },
    };
    cm.addKeyMap(keyMap);

    const docHandler = function (e) {
      if (!ul.contains(e.target)) closeHintWidget();
    };
    document.addEventListener("mousedown", docHandler);

    activeHint = { el: ul, cm, result, keyMap, docHandler, skipNext: false };
  }

  function applyModeToEditor(cm) {
    cm[STAMP] = true;
    ensureModeRegistered(cm.constructor);
    cm.setOption("mode", "foreshadow");
    if (cm.constructor.registerHelper)
      cm.setOption("lint", { getAnnotations: lintForeshadow, async: false });

    cm.on("change", function (instance, change) {
      if (activeHint && activeHint.skipNext) {
        activeHint.skipNext = false;
        return;
      }
      const ch = change.text[0] && change.text[0][0];
      if (
        change.origin === "+input" &&
        (ch === "(" || ch === "|" || /^[a-z_]$/i.test(ch))
      ) {
        showHintWidget(instance);
      } else {
        closeHintWidget();
      }
    });
  }

  function patchExisting() {
    document.querySelectorAll(".CodeMirror").forEach(function (el) {
      if (el.CodeMirror && !el.CodeMirror[STAMP])
        applyModeToEditor(el.CodeMirror);
    });
  }

  if (typeof window.CodeMirror !== "undefined")
    ensureModeRegistered(window.CodeMirror);

  setTimeout(patchExisting, 0);
  const observer = new MutationObserver(function () {
    setTimeout(patchExisting, 0);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})(); } catch(e) { /* editor features unavailable */ }

window.storyFormat({
  name: "Foreshadow",
  version: VERSION,
  author: "Rene Tailleur",
  description:
    "Export your Twine 2 story as a JSON document, with syntax highlighting for Foreshadow dialogue manager, based on JTwine-to-JSON",
  proofing: false,
  source: `
	<html>
	<head>
        <meta http-equiv='Content-Type' content='text/html; charset=UTF-8' />
		<title>Foreshadow JSON</title>
        <script type='text/javascript'>
            /**
* Foreshadow: modified by Rene Tailleur for use in Foreshadow Dialogue Manager
*
* Originally adapted from [JTwine-to-JSON](https://github.com/BL-MSCH-C220/JTwine-to-JSON) adapted from [twine-to-json](https://jtschoonhoven.github.io/twine-to-json/)
*
*
*
* Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
* associated documentation files (the 'Software'), to deal in the Software without restriction,
* including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
* and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
* subject to the following conditions:
*
* The above copyright notice and this permission notice shall be included in all copies or substantial
* portions of the Software.
*
* THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
* LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
* IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
* WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
* SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
const STORY_TAG_NAME = 'tw-storydata';
const PASSAGE_TAG_NAME = 'tw-passagedata';
const FORMAT_TWINE = 'twine';
const FORMAT_HARLOWE_3 = 'harlowe-3';
const VALID_FORMATS = [FORMAT_TWINE, FORMAT_HARLOWE_3];
/**
 * Convert Twine story to JSON.
 */
function twineToJSON(format) {
    const storyElement = document.getElementsByTagName(STORY_TAG_NAME)[0];
    const storyMeta = getElementAttributes(storyElement);
    const result = {
        story: storyMeta.name,
		startnode: storyMeta.startnode
    };
    validate(format);
    const passageElements = Array.from(storyElement.getElementsByTagName(PASSAGE_TAG_NAME));
    result.passages = passageElements.map((passageElement) => {
        return processPassageElement(passageElement, format);
    });
	for (i in result.passages){
		p = result.passages[i];
		for (j in p["links"]){
			l = p["links"][j];
			temp = parseInt(j) + 1
			l["selection"] = temp.toString();
			n = l["newPassage"];
			for (k in result.passages){
				s = result.passages[k];
				if (s["name"] == n){
					l["pid"] = s["pid"]
				}
			}
		}
	}
    return result;
}
/**
 * Validate story and inputs. Currently this only validates the format arg. TODO: make this more robust.
 */
function validate(format) {
    const isValidFormat = VALID_FORMATS.some(validFormat => validFormat === format);
    if (!isValidFormat) {
        throw new Error('Format is not valid.');
    }
}
/**
 * Convert the HTML element for a story passage to JSON.
 */
function processPassageElement(passageElement, format) {
    const passageMeta = getElementAttributes(passageElement);
    const result = {
        tags: passageMeta.tags,
        pid: passageMeta.pid,
    };
    result.original = passageElement.innerText.trim();
    Object.assign(result, processPassageText(result.original, format));
    result.text = sanitizeText(result.original, result.links, result.hooks, format);
    return result;
}
function processPassageText(passageText, format) {
    const result = { links: [] };
    if (format === FORMAT_HARLOWE_3) {
        result.hooks = [];
    }
    let currentIndex = 0;
    while (currentIndex < passageText.length) {
        const maybeLink = extractLinksAtIndex(passageText, currentIndex);
        if (maybeLink) {
            result.links.push(maybeLink);
            currentIndex += maybeLink.original.length;
        }
        if (format !== FORMAT_HARLOWE_3) {
            currentIndex += 1;
            continue;
        }
        const maybeLeftHook = extractLeftHooksAtIndex(passageText, currentIndex);
        if (maybeLeftHook) {
            result.hooks.push(maybeLeftHook);
            currentIndex += maybeLeftHook.original.length;
        }
        currentIndex += 1;
        const maybeHook = extractHooksAtIndex(passageText, currentIndex);
        if (maybeHook) {
            result.hooks.push(maybeHook);
            currentIndex += maybeHook.original.length;
        }
    }
    return result;
}
function extractLinksAtIndex(passageText, currentIndex) {
    const currentChar = passageText[currentIndex];
    const nextChar = passageText[currentIndex + 1];
    if (currentChar === '[' && nextChar === '[') {
        const link = getSubstringBetweenBrackets(passageText, currentIndex + 1);
        const leftSplit = link.split('<-', 2);
        const rightSplit = link.split('->', 2);
        const original = passageText.substring(currentIndex, currentIndex + link.length + 4);
        if (leftSplit.length === 2) {
            return { original: original, label: leftSplit[1], newPassage: leftSplit[0], pid: "", selection: "" };
        }
        else if (rightSplit.length === 2) {
            return { original: original, label: rightSplit[0], newPassage: rightSplit[1], pid: "", selection: "" };
        }
        else {
            return { original: original, label: link, newPassage: link, pid: "", selection: "" };
        }
    }
}
function extractLeftHooksAtIndex(passageText, currentIndex) {
    const regexAlphaNum = /[a-z0-9]+/i;
    const currentChar = passageText[currentIndex];
    if (currentChar === '|') {
        const maybeHookName = getSubstringBetweenBrackets(passageText, currentIndex, '|', '>');
        if (maybeHookName.match(regexAlphaNum)) {
            const hookStartIndex = currentIndex + maybeHookName.length + 2; // advance to next char after ">"
            const hookStartChar = passageText[hookStartIndex];
            if (hookStartChar === '[') {
                const hookText = getSubstringBetweenBrackets(passageText, hookStartIndex);
                const hookEndIndex = hookStartIndex + hookText.length + 2;
                const original = passageText.substring(currentIndex, hookEndIndex);
                return { hookName: maybeHookName, hookText: hookText, original: original };
            }
        }
    }
}
function extractHooksAtIndex(passageText, currentIndex) {
    const regexAlphaNum = /[a-z0-9]+/i;
    const currentChar = passageText[currentIndex];
    const nextChar = passageText[currentIndex + 1];
    const prevChar = currentIndex && passageText[currentIndex - 1];
    if (currentChar === '[' && nextChar !== '[' && prevChar !== '[') {
        const hookText = getSubstringBetweenBrackets(passageText, currentIndex);
        const hookEndIndex = currentIndex + hookText.length + 2;
        const hookEndChar = passageText[hookEndIndex];
        if (hookEndChar === '<') {
            const maybeHookName = getSubstringBetweenBrackets(passageText, hookEndIndex, '<', '|');
            if (maybeHookName.match(regexAlphaNum)) {
                const original = passageText.substring(currentIndex, hookEndIndex + maybeHookName.length + 2);
                return { hookName: maybeHookName, hookText: hookText, original: original };
            }
        }
        const original = passageText.substring(currentIndex, hookText.length + 2);
        return { hookName: undefined, hookText: hookText, original: original };
    }
}
function sanitizeText(passageText, links, hooks, format) {
    links.forEach((link) => {
        passageText = passageText.replace(link.original, '');
    });
    if (format === FORMAT_HARLOWE_3) {
        hooks.forEach((hook) => {
            passageText = passageText.replace(hook.original, '');
        });
    }
    return passageText.trim();
}
/**
 * Convert an HTML element to an object of attribute values.
 */
function getElementAttributes(element) {
    const result = {};
    const attributes = Array.from(element.attributes);
    attributes.forEach((attribute) => {
        result[attribute.name] = attribute.value;
    });
    return result;
}
/**
 * True if string starts with the given substring.
 */
function stringStartsWith(string, startswith) {
    return string.trim().substring(0, startswith.length) === startswith;
}
function getSubstringBetweenBrackets(string, startIndex, openBracket, closeBracket) {
    openBracket = openBracket || '[';
    closeBracket = closeBracket || ']';
    const bracketStack = [];
    let currentIndex = startIndex || 0;
    let substring = '';
    if (string[currentIndex] !== openBracket) {
        throw new Error('startIndex of getSubstringBetweenBrackets must correspond to an open bracket');
    }
    while (currentIndex < string.length) {
        const currentChar = string[currentIndex];
        // pull top bracket from stack if we hit a close bracket
        if (currentChar === closeBracket) {
            bracketStack.pop();
        }
        // build substring so long as stack is populated
        if (bracketStack.length) {
            substring += currentChar;
        }
        // add open brackets to the top of the stack
        if (currentChar === openBracket) {
            bracketStack.push(currentChar);
        }
        // return if stack is empty and substring is set
        if (!bracketStack.length) {
            return substring;
        }
        currentIndex += 1;
    }
    return substring;
}
        </script>
	</head>
	<body>
        <pre id='content'></pre>
        <div id='storyData' style='display: none;'>{{STORY_DATA}}</div>
        <script type='text/javascript'>document.getElementById('content').innerHTML = JSON.stringify(twineToJSON("twine"), null, 2);</script>
	</body>
</html>
	`,
});
