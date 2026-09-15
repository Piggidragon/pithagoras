# Speech fixture

`jfk.wav` is the sample bundled with
[Whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/master/samples/jfk.wav):
an excerpt from President John F. Kennedy's inaugural address. Browser tests
feed it into a synthetic MediaStream; they never use the physical microphone.
