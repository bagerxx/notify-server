# Değişkenler
PROJECT_ID = plankolay-63aa7
REPO = app-image-repo
SERVICE = notify-server
REGION = us-central1
VERSİON = v1
IMAGE = us-central1-docker.pkg.dev/$(PROJECT_ID)/$(REPO)/$(SERVICE):$(VERSİON)
BASE_URL = https://notify.mihrasoft.com
WAKEUP_TOKEN = 9z4jGlyw6Ak2VgkBoGaA.UQFsjF3A8zqhuiaO13EuRmyAvBFjdvu
# Sadece Build almak istersen
build:
	gcloud builds submit --tag $(IMAGE) --gcs-source-staging-dir=gs://deploy-dosyalari/source .

# Sadece Deploy etmek istersen
deploy:
	gcloud run deploy $(SERVICE) --image $(IMAGE) --region $(REGION) --allow-unauthenticated --env-vars-file=env.yaml\

# Tek tıkla hem build hem deploy (İkisini art arda yapar)
shipit: build deploy

uyandirici:
	gcloud scheduler jobs create http notify-uyandirici \
		--location=$(REGION) \
		--schedule="*/10 * * * *" \
		--uri="$(BASE_URL)/health" \
		--http-method=GET \
		--headers="X-Wakeup-Token=$(WAKEUP_TOKEN)"

uyandirici-guncelle:
	gcloud scheduler jobs update http notify-uyandirici \
		--location=$(REGION) \
		--schedule="*/10 * * * *" \
		--uri="$(BASE_URL)/health" \
		--http-method=GET \
		--headers="X-Wakeup-Token=$(WAKEUP_TOKEN)"