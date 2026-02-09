import requests
from bs4 import BeautifulSoup
import urllib3

# Desactivar las advertencias de solicitud insegura que aparecen al usar verify=False
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def obtener_tasa_oficial_bcv():
    """
    Obtiene la tasa de cambio oficial del Dólar desde la página del BCV.
    """
    try:
        URL = "https://www.bcv.org.ve/"
        # El header simula un navegador para evitar bloqueos simples.
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        # Se añade verify=False para evitar errores de verificación de certificado SSL.
        response = requests.get(URL, headers=headers, timeout=15, verify=False)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Buscamos el div con id "dolar", y dentro de él, el tag <strong>
        dolar_div = soup.find('div', id='dolar')
        if not dolar_div:
            print("❌ No se encontró el contenedor del dólar (id='dolar'). La estructura de la página pudo haber cambiado.")
            return None
            
        valor_str = dolar_div.find('strong').text.strip()
        
        # Limpieza del string: "36,32940000" -> 36.3294
        valor_limpio = valor_str.replace('.', '').replace(',', '.')
        
        return float(valor_limpio)

    except requests.exceptions.RequestException as e:
        print(f"❌ Error de red al contactar al BCV: {e}")
        return None
    except (AttributeError, IndexError) as e:
        print(f"❌ Error de scraping en BCV: No se encontró el elemento. La estructura de la página pudo haber cambiado. Error: {e}")
        return None
    except ValueError:
        print(f"❌ No se pudo convertir el valor '{valor_str}' a un número.")
        return None

if __name__ == "__main__":
    # --- Prueba ---
    print("Buscando tasa oficial del BCV...")
    tasa_bcv = obtener_tasa_oficial_bcv()
    if tasa_bcv:
        print(f"✅ Tasa oficial BCV obtenida: {tasa_bcv}")
    else:
        print("❌ No se pudo obtener la tasa oficial BCV.")