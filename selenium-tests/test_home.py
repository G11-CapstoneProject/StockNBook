from selenium import webdriver

driver = webdriver.Chrome()

driver.get("http://localhost:3000")

print("Page Title:", driver.title)
print("The browser will remain open.")
input("Press Enter to close the browser...")

driver.quit()