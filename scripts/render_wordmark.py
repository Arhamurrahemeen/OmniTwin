"""One-off: render docs/OmniTwin_Wordmark_Dark.pdf page 1 -> frontend/src/assets/wordmark.png."""
import fitz
pdf = fitz.open("docs/OmniTwin_Wordmark_Dark.pdf")
page = pdf[0]
pix = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
pix.save("frontend/src/assets/wordmark.png")
print("saved frontend/src/assets/wordmark.png")