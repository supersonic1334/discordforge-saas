const MAX_INPUT_FILE_SIZE = 20 * 1024 * 1024
const MAX_OUTPUT_LENGTH = 320_000
const MAX_DIMENSION = 320
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Impossible de lire cette image.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image invalide.'))
    image.src = dataUrl
  })
}

function drawAvatar(image, mimeType, quality, maxDimension = MAX_DIMENSION) {
  const ratio = Math.min(maxDimension / image.width, maxDimension / image.height, 1)
  const width = Math.max(1, Math.round(image.width * ratio))
  const height = Math.max(1, Math.round(image.height * ratio))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Le navigateur ne peut pas preparer cette image.')
  }

  context.clearRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)
  return canvas.toDataURL(mimeType, quality)
}

function buildAvatarVariants(image, sourceMimeType) {
  const prefersJpeg = String(sourceMimeType || '').includes('jpeg') || String(sourceMimeType || '').includes('jpg')

  const jpegFirst = [
    ['image/jpeg', 0.82, 320],
    ['image/jpeg', 0.74, 288],
    ['image/jpeg', 0.66, 256],
    ['image/webp', 0.8, 320],
    ['image/webp', 0.72, 288],
    ['image/webp', 0.64, 256],
  ]

  const webpFirst = [
    ['image/webp', 0.84, 320],
    ['image/webp', 0.76, 288],
    ['image/webp', 0.68, 256],
    ['image/jpeg', 0.8, 320],
    ['image/jpeg', 0.72, 288],
    ['image/jpeg', 0.64, 256],
  ]

  return prefersJpeg ? jpegFirst : webpFirst
}

export async function prepareAvatarDataUrl(file) {
  if (!file) throw new Error('Aucun fichier selectionne.')
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error('Formats acceptes: JPG, PNG, WEBP ou GIF.')
  }
  if (file.size > MAX_INPUT_FILE_SIZE) {
    throw new Error('Image trop lourde. Maximum: 20 Mo.')
  }

  const sourceDataUrl = await readFileAsDataUrl(file)
  const image = await loadImage(sourceDataUrl)

  for (const [mimeType, quality, maxDimension] of buildAvatarVariants(image, file.type)) {
    const output = drawAvatar(image, mimeType, quality, maxDimension)
    if (output.length <= MAX_OUTPUT_LENGTH) {
      return output
    }
  }

  throw new Error('Image trop lourde apres compression. Choisis une image plus legere.')
}
