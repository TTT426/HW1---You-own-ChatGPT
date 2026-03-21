# Step
Terminal 1
```
uvicorn server:app --reload --port 8000
```
Terminal 2
```
python3 -m http.server 5000
```
On browser
```
http://localhost:5000/
```
# How to set a new language UI design? 
1. open config/ui.config
And use this template
```
FONT_UI_{your new language}={Font Style}
FONT_MONO_{your new language}={Font Style}
```
2. Fillin all items translate result in your new language [tempmethod]
For example
```
"zh-TW": {
      "appTitle": "My ChatGPT",
      "settings": "設定",
      "provider": "服務商",
      "model": "模型",
      "systemPrompt": "系統提示詞",
      ...
    }
```
# How to UpLoad a template?
Add it into input/{your_templatename}.pptx

# How to Add model?
0. need add config/api_key.config manually
1. open config/providers.json
2. using this template
The name in "label" can name it anything
```
"Your model provider": {
    "label": "xxxxxxxxx",
    "endpoint": (if is cloud, is an url, if is a local model, is null),
    "keyPrefix": (if is cloud, is your apikey prefix, if is a local model, is null),
    "models": [
        { "value": "your model name", "label": "xxxxxxxxxx" },
        ...
    ]
}
```