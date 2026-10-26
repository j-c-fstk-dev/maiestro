# Seus samples

Coloque aqui seus próprios samples (ex.: vocais) e um arquivo `strudel.json` descrevendo-os.
O MAESTRO carrega esse arquivo sozinho ao dar play (se ele existir).

Exemplo de pasta:

```
public/samples/
├─ strudel.json
└─ vocal/
   ├─ aah.wav
   └─ ooh.wav
```

`strudel.json`:

```json
{
  "vocal": ["vocal/aah.wav", "vocal/ooh.wav"]
}
```

Depois use numa camada de código, por exemplo:

```
/raw vocal s("vocal:0").slow(4).room(0.8).gain(0.6)
```

ou peça ao maestro: *"coloca o sample vocal na camada de voz, bem espaçado e com bastante reverb"*.

Use só samples que você tem direito de usar (gravados por você ou com licença livre, ex.: CC0) se for publicar a música.
