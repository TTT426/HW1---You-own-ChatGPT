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

# How to Add model?
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