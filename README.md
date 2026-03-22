# Foreshadow JSON
A story format for converting a Twine 2 story to JSON with special support for Harlowe 3.x and inline scripting for the Foreshadow Dialogue manager (a Godot library).

Forshadow JSON adds syntax highlighting to [JTwine-to-JSON](https://github.com/BL-MSCH-C220/JTwine-to-JSON) which iteself makes a few useful changes to [Twine-to-JSON](https://jtschoonhoven.github.io/twine-to-json/), which was inspired by [Twison](https://github.com/lazerwalker/twison). Twison was, in turn, inspired by [Entweedle](http://www.maximumverbosity.net/twine/Entweedle/).

## Setup

From the Twine 2 homescreen, select the Twine Menu, then "Story Format". "+ Add" a New Format. At the prompt, "Paste in the address below": `https://cdn.githubraw.com/hallucination-gallery/Foreshadow-JSON/main/format.js`


## Export

Once you’ve installed format, enter your story and choose Change Story Format. Select the new format and return to your story. Selecting Play will generate a JSON file in your browser. It can then be copied for use elsewhere.

## Example Output
```
{
  "story": "Error",
  "startnode": "1",
  "passages": [
    {
      "name": "Error",
      "tags": "Error",
      "pid": "1",
      "original": "((set|can_exit|true))\n\nThis text should not be [hint=because its so dark in here]visible[/hint] if you are playing a game. Please submit a bug report with the following information.\n\n((debug_log))\n\n\n[[Can I see anything?]]\n[[Fight]]\n[[Test Link Two]]",
      "links": [
        {
          "original": "[[Can I see anything?]]",
          "label": "Can I see anything?",
          "newPassage": "Can I see anything?",
          "pid": "4",
          "selection": "1"
        },
        {
          "original": "[[Fight]]",
          "label": "Fight",
          "newPassage": "Fight",
          "pid": "5",
          "selection": "2"
        },
        {
          "original": "[[Test Link Two]]",
          "label": "Test Link Two",
          "newPassage": "Test Link Two",
          "pid": "3",
          "selection": "3"
        }
      ],
      "text": "((set|can_exit|true))\n\nThis text should not be [hint=because its so dark in here]visible[/hint] if you are playing a game. Please submit a bug report with the following information.\n\n((debug_log))"
    },
    {
      "name": "Test Link",
      "tags": "Error Test Test-Two",
      "pid": "2",
      "original": "I appreciate the thoroughness of your investigation but you still shouldn't be here.\n\n[[Error]]",
      "links": [
        {
          "original": "[[Error]]",
          "label": "Error",
          "newPassage": "Error",
          "pid": "1",
          "selection": "1"
        }
      ],
      "text": "I appreciate the thoroughness of your investigation but you still shouldn't be here."
    },
    {
      "name": "Test Link Two",
      "tags": "Error",
      "pid": "3",
      "original": "((set|varcheck|11))\n\n((if|varcheck > 0|Variable is greater than zero.((if|varcheck > 1| Variable is also greater than one.((if|varcheck > 10| In fact, it's greater than ten.))| It is exaclty one.))|Variable is less than One.((if|varcheck < 0| It's a negative number.| It's exactly zero.))))\n\n[[Error]]",
      "links": [
        {
          "original": "[[Error]]",
          "label": "Error",
          "newPassage": "Error",
          "pid": "1",
          "selection": "1"
        }
      ],
      "text": "((set|varcheck|11))\n\n((if|varcheck > 0|Variable is greater than zero.((if|varcheck > 1| Variable is also greater than one.((if|varcheck > 10| In fact, it's greater than ten.))| It is exaclty one.))|Variable is less than One.((if|varcheck < 0| It's a negative number.| It's exactly zero.))))"
    },
    {
      "name": "Can I see anything?",
      "tags": "",
      "pid": "4",
      "original": "((signal|social_interaction_started))\nThere's nothing here.\n\n[[Fight]] \n[[Give Up]]",
      "links": [
        {
          "original": "[[Fight]]",
          "label": "Fight",
          "newPassage": "Fight",
          "pid": "5",
          "selection": "1"
        },
        {
          "original": "[[Give Up]]",
          "label": "Give Up",
          "newPassage": "Give Up",
          "pid": "6",
          "selection": "2"
        }
      ],
      "text": "((signal|social_interaction_started))\nThere's nothing here."
    },
    {
      "name": "Fight",
      "tags": "",
      "pid": "5",
      "original": "((signal|combat_started))\nThere's nothing here to fight, but you raise your fists anyway.\n\n[[Can I see anything?]] \n[[Give Up]]",
      "links": [
        {
          "original": "[[Can I see anything?]]",
          "label": "Can I see anything?",
          "newPassage": "Can I see anything?",
          "pid": "4",
          "selection": "1"
        },
        {
          "original": "[[Give Up]]",
          "label": "Give Up",
          "newPassage": "Give Up",
          "pid": "6",
          "selection": "2"
        }
      ],
      "text": "((signal|combat_started))\nThere's nothing here to fight, but you raise your fists anyway."
    },
    {
      "name": "Give Up",
      "tags": "",
      "pid": "6",
      "original": "((signal|returned_to_exploration))\nI always knew you were a quitter.\n\n[[Error]] \n[[Fight]] \n[[Can I see anything?]]",
      "links": [
        {
          "original": "[[Error]]",
          "label": "Error",
          "newPassage": "Error",
          "pid": "1",
          "selection": "1"
        },
        {
          "original": "[[Fight]]",
          "label": "Fight",
          "newPassage": "Fight",
          "pid": "5",
          "selection": "2"
        },
        {
          "original": "[[Can I see anything?]]",
          "label": "Can I see anything?",
          "newPassage": "Can I see anything?",
          "pid": "4",
          "selection": "3"
        }
      ],
      "text": "((signal|returned_to_exploration))\nI always knew you were a quitter."
    },
    {
      "name": "Leave",
      "tags": "",
      "pid": "7",
      "original": "((set|can_exit|false))((signal|returned_to_exploration))((signal|closed_foreshadow))",
      "links": [],
      "text": "((set|can_exit|false))((signal|returned_to_exploration))((signal|closed_foreshadow))"
    }
  ]
}
```
